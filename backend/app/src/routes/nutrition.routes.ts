import { Router, Request, Response } from 'express';
import { Prisma, NutritionEntry } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { parsePaginationParams, buildPaginationMeta } from '../adapters/pagination.adapter';
import { authMiddleware } from '../middlewares/auth.middleware';
// Shared with POST /api/recipes, which derives macros from the same figure.
// See lib/nutrition/limits.ts for what an unbounded one costs on each path.
import { MAX_GRAMS } from '../lib/nutrition/limits';
import { z } from 'zod';

const router = Router();

/**
 * The most energy a caller may STATE for one serving.
 *
 * `nonnegative()` is no more of a bound than `positive()` was: `calories: 1e308`
 * passes zod and stores at 201, and nothing overflows on the way in. It is the
 * NEXT merge that detonates. The merge adds IN THE DATABASE, `1e308 + 1e308` is
 * out of range for a `double precision` column, and Postgres RAISES — SQLSTATE
 * 22003, `value out of range: overflow` — instead of saturating or producing an
 * Infinity. Measured end to end: the following merge answered
 * `500 {"error":{"message":"Failed to save nutrition entry"}}`, and it answers
 * that for that row FOREVER, because the poisoned value is the left-hand side of
 * every later sum. One request permanently costs the user the ability to log
 * that food.
 *
 * 1000000 kcal, from what a real food can be, the way MAX_GRAMS is: the densest
 * a food can be is pure fat at 9 kcal per gram, so the most energy MAX_GRAMS —
 * 100 kg — can hold is 900000 kcal. A million clears that with room to spare and
 * costs no legitimate caller anything.
 *
 * Protein, carbs and fat are WEIGHTS, and a macro cannot weigh more than the
 * food it is part of, so their ceiling is MAX_GRAMS itself.
 *
 * DECISION — these bound ONE REQUEST, never the stored total. A row that has
 * absorbed many merges may legitimately hold more than any single serving could,
 * and rejecting THAT would be this same defect from the other side: the row
 * would become un-mergeable and the user could never log that food into it
 * again — a 400 forever in place of a 500 forever. What the input ceiling has to
 * buy is that no REACHABLE sum can overflow, and it does: at a million per
 * request it would take on the order of 1e302 requests to approach
 * Number.MAX_VALUE. So the sum is deliberately left unbounded, and pinned that
 * way by test.
 */
const MAX_KCAL = 1000000;

const CreateNutritionEntrySchema = z.object({
    foodItemId: z.string().uuid().optional(),
    foodName: z.string().min(1, 'Food name is required'),
    grams: z.number().positive().max(MAX_GRAMS),
    mealCategory: z.enum(['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snacks']),
    date: z.string().optional().default(() => new Date().toISOString()),
    calories: z.number().nonnegative().max(MAX_KCAL).optional(),
    protein: z.number().nonnegative().max(MAX_GRAMS).optional(),
    carbs: z.number().nonnegative().max(MAX_GRAMS).optional(),
    fat: z.number().nonnegative().max(MAX_GRAMS).optional(),
    // The instants that bound the user's day, used as the merge window. Kept
    // optional so a browser still running an older bundle during a deploy keeps
    // working; the current frontend always sends both. Parsed by parseBound
    // rather than typed here so a bad bound answers 400 with the reason.
    mergeFrom: z.string().optional(),
    mergeTo: z.string().optional()
});

const UpdateNutritionEntrySchema = z.object({
    // The same ceilings as the create path, for the same reasons: PATCH
    // recomputes the same macros from the same product, and it takes the same
    // four stated macros verbatim, so a row poisoned through here is exactly as
    // un-mergeable as one poisoned through POST.
    //
    // The ceiling is only half of it. `caloriesPer100g` is an unbounded Float
    // that arrives from a different route, so a serving well inside MAX_GRAMS
    // can still overflow against a poisoned FoodItem — which is why the handler
    // below carries the same Number.isFinite check the create path does. This
    // comment used to claim that guarantee while only the ceiling existed.
    grams: z.number().positive().max(MAX_GRAMS).optional(),
    mealCategory: z.enum(['Desayuno', 'Almuerzo', 'Merienda', 'Cena', 'Snacks']).optional(),
    calories: z.number().nonnegative().max(MAX_KCAL).optional(),
    protein: z.number().nonnegative().max(MAX_GRAMS).optional(),
    carbs: z.number().nonnegative().max(MAX_GRAMS).optional(),
    fat: z.number().nonnegative().max(MAX_GRAMS).optional()
});

const NutritionGoalSchema = z.object({
    kcal: z.number().positive(),
    proteinG: z.number().positive(),
    carbsG: z.number().positive(),
    fatG: z.number().positive()
});

// GET user's nutrition goal
router.get('/goal', authMiddleware, async (req: Request, res: Response) => {
    try {
        let goal = await prisma.nutritionGoal.findUnique({
            where: { userId: req.user!.userId }
        });
        
        // Return default if none exists
        if (!goal) {
            goal = {
                id: 'default',
                userId: req.user!.userId,
                kcal: 2000,
                proteinG: 150,
                carbsG: 200,
                fatG: 65,
                isCalculated: false,
                updatedAt: new Date()
            };
        }
        res.json({ data: goal });
    } catch (err: any) {
        // The caught message belongs to whoever operates the database, not to
        // whoever is holding the phone. A Prisma or driver failure spells out
        // the table, the column, the constraint and — when the pool is what
        // broke — the connection string, credentials included: a free map of
        // the schema, handed to an unauthenticated guess, that tells the caller
        // nothing it could act on. Generic on the wire, whole in the log, the
        // way the create, update and delete handlers below already answer.
        console.error('Error fetching nutrition goal:', err);
        res.status(500).json({ error: { message: 'Failed to fetch nutrition goal' } });
    }
});

// POST update user's nutrition goal
router.post('/goal', authMiddleware, async (req: Request, res: Response) => {
    const parseResult = NutritionGoalSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    const userId = req.user!.userId;
    const { kcal, proteinG, carbsG, fatG } = parseResult.data;

    try {
        const goal = await prisma.nutritionGoal.upsert({
            where: { userId },
            update: { kcal, proteinG, carbsG, fatG, isCalculated: false },
            create: { userId, kcal, proteinG, carbsG, fatG, isCalculated: false }
        });
        res.json({ data: goal });
    } catch (err: any) {
        console.error('Error saving nutrition goal:', err);
        res.status(500).json({ error: { message: 'Failed to save nutrition goal' } });
    }
});

/**
 * The widest merge window a caller may send.
 *
 * The window is untrusted input, and an unbounded one merges across anything:
 * a window of a century adds today's food to a row from a previous year, which
 * then disappears from today's diary — the same lost meal this window exists to
 * prevent, arriving through the input that replaced the server's own day.
 *
 * 28 hours, from measurement rather than from a round number. Sweeping every
 * IANA zone at one-minute resolution around every offset transition from 2015
 * to 2035, the longest local day dayBounds() can produce is 27 hours and the
 * shortest is 21 — both Antarctica/Casey, which shifts three hours at a time,
 * not the one hour ordinary DST moves. 28 clears the real maximum with an hour
 * to spare.
 *
 * It was 48, which is two days: [day N 00:00, day N+1 24:00) is 48 hours minus
 * a millisecond, so a caller could merge an entry it dated on the 30th into a
 * row from the 29th, and the meal vanished from the 30th. That is this bug
 * again, arriving through the input that replaced the server's own day.
 */
const MAX_MERGE_WINDOW_MS = 28 * 60 * 60 * 1000;

/**
 * An ISO-8601 instant: a date, a time, and an EXPLICIT zone designator.
 *
 * The zone is the part that matters. `new Date()` accepts far looser input and
 * resolves whatever it accepts against the server's own clock — "July 31 2026"
 * is 03:00Z in Buenos Aires, 00:00Z in UTC and the day before at 15:00Z in
 * Tokyo, and "2026-07-31T02:00:00" is local time by definition. Either one lets
 * a bound mean a different instant depending on where the process happens to
 * run, which is exactly the server-timezone dependency these bounds replaced.
 * Only a string that denotes ONE instant, the same everywhere, is a valid bound.
 *
 * What it does NOT do is demand the browser's exact spelling of the rest. ISO
 * 8601 is wider than `Date.prototype.toISOString()`, and this pattern was
 * narrower than ISO — which quietly narrowed an endpoint that had already
 * shipped, because the GET range filter shares this parser. Three legitimate
 * forms answered 400:
 *
 *   - MORE THAN THREE FRACTIONAL DIGITS, which is what Python's
 *     `datetime.isoformat()`, Go's `RFC3339Nano`, Java's `Instant.toString()`
 *     and a Postgres `::text` cast all emit.
 *   - A LOWER CASE `t` or `z`, which RFC 3339 §5.6 explicitly permits.
 *   - A BASIC-FORMAT OFFSET, `+0300`, the same offset without its colon.
 *
 * None of the three costs the zone guarantee, so all three are accepted. A
 * string with NO zone designator, and a date with no time at all, stay refused:
 * that is the whole point of the check.
 *
 * Every field is captured, for two reasons. The shape being right does not make
 * the DAY real — see the calendar check in parseBound — and the shape being
 * right does not make the TIME real either: `T24:00:00` matches, and V8 rolls it
 * to 00:00 the next day.
 */
const ISO_INSTANT =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?([Zz]|[+-]\d{2}:?\d{2})$/;

/**
 * Parses an optional ISO-8601 instant from a query string or a request body.
 *
 * Shared by the GET range filter and the POST merge window. Both callers send
 * `Date.prototype.toISOString()`, whose output this accepts unchanged.
 *
 * @throws Error when present but not an ISO instant — a bad bound must not be
 *         ignored, or the caller silently gets a different range than it asked
 *         for, and must not be guessed at either.
 */
function parseBound(raw: unknown, name: string): Date | undefined {
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string') throw new Error(`${name} must be a single ISO-8601 instant string`);
    const shape = ISO_INSTANT.exec(raw);
    if (!shape) {
        throw new Error(`${name} must be an ISO-8601 instant with a timezone, e.g. 2026-07-31T02:00:00.000Z`);
    }

    const [, year, month, day, hour, minute, second = '00', fraction = '', zone] = shape;

    // The TIME OF DAY has to be real, checked here rather than left to the parse.
    //
    // An hour of 24 is the one the parse gets WRONG rather than rejects:
    // "2026-07-31T24:00:00Z" is 2026-08-01T00:00:00Z to `new Date`, so the bound
    // lands on a day the string does not name, and the calendar check below
    // waves it through because the day it validates — the 31st — really does
    // exist. It is the same "a bound must not mean a different instant than it
    // says" defect as the month-end rollover, arriving through the clock instead
    // of the calendar, and the width cap sees nothing because a SHIFTED window
    // is not a WIDER one. Measured: mergeFrom="2026-07-30T24:00:00.000Z" moved
    // the whole window twenty-one hours and still answered 201.
    //
    // 60 in the minute or second field is refused too. V8 already refuses both
    // — measured — but the normalisation below rebuilds the string, and the
    // obvious way to rebuild it, through `Date.UTC(y, m, d, h, mi, s)`, would
    // roll 02:60 forward to 03:00 and hand back a bound nobody wrote. The check
    // is what keeps that from being a silent change.
    if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
        throw new Error(`${name} is not a real time of day: ${hour}:${minute}:${second}`);
    }

    // Normalised to the ONE spelling ECMA-262 defines before it is parsed, so
    // the pattern and `new Date` cannot disagree about what was accepted.
    //
    // V8 does take all three widened forms as they stand — probed, each one
    // resolves to the instant it names — but it takes them through its
    // IMPLEMENTATION-DEFINED fallback parser, since none of the three is in the
    // Date Time String Format the spec pins. Widening the pattern to a shape and
    // then relying on an engine's leniency to honour it just moves the 400 one
    // line down, on whichever engine stops being lenient. Rebuilding the string
    // out of the captured fields is what makes "the pattern accepts it" and
    // "the parse agrees" the same statement.
    //
    // The fraction is TRUNCATED to milliseconds, not rounded, which is what V8
    // does with the extra digits and all the column can hold anyway.
    const millis = `${fraction}000`.slice(0, 3);
    const offset = zone.length === 1 ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(-2)}`;
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}${offset}`);
    if (Number.isNaN(parsed.getTime())) throw new Error(`${name} must be a valid ISO-8601 instant`);

    // The shape is right and the parse succeeded; the DAY still has to exist.
    // A month of 13, a day of 00 and an hour of 25 are already Invalid Date
    // above, but a day PAST THE END OF ITS MONTH is not: "2026-02-31T00:00:00Z"
    // parses happily and comes back as 2026-03-03. The bound then means an
    // instant three days from the one it spells, and it moves silently — its
    // width is untouched, so the 48-hour cap has nothing to complain about.
    // Rebuilding the day and checking it survived is the whole test.
    const calendar = new Date(0);
    calendar.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
    if (calendar.getUTCDate() !== Number(day)) {
        throw new Error(`${name} is not a real date: ${year}-${month} has no day ${day}`);
    }
    return parsed;
}

// Get user's nutrition history, optionally narrowed to an instant range
router.get('/', authMiddleware, async (req: Request, res: Response) => {
    let from: Date | undefined;
    let to: Date | undefined;
    try {
        from = parseBound(req.query.from, 'from');
        to = parseBound(req.query.to, 'to');
        if (from && to && from > to) throw new Error('from must not be after to');
    } catch (err: any) {
        res.status(400).json({ error: { message: 'Validation error', details: err.message } });
        return;
    }

    try {
        const { offset, limit } = parsePaginationParams(
            req.query.offset as string | undefined,
            req.query.limit as string | undefined
        );

        // An explicit INSTANT range, HALF-OPEN: [from, to). The day boundaries
        // are the caller's to decide: only it knows the user's timezone, and a
        // server-side start-of-day would file an entry logged at 23:00 in
        // Buenos Aires under the following UTC day.
        //
        // The upper bound is EXCLUSIVE because the caller names the end of a day
        // as the start of the NEXT one — the only way to name it that survives a
        // DST fall-back, where a local wall-clock time near midnight happens
        // twice and denotes the earlier of the two. Two adjacent ranges then
        // partition the entries instead of both claiming the instant they share,
        // which would put one meal on two days and overstate the totals of each.
        // It is the same interval POST validates the merge window with, so the
        // diary can never show an entry the write path would have refused.
        const where: Prisma.NutritionEntryWhereInput = {
            userId: req.user!.userId,
            ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
        };

        const [entries, total] = await Promise.all([
            prisma.nutritionEntry.findMany({
                where,
                include: { foodItem: true },
                // `date` ALONE is not a total order: the diary sends
                // `selectedDate.toISOString()` from a `useState(new Date())`
                // captured once at mount, so every entry logged in one sitting
                // on one day carries the identical millisecond. Among tied
                // rows the plan decides what comes back, and that answer is
                // not even stable across a write — Postgres never rewrites a
                // row in place, an UPDATE appends a new tuple version at the
                // end of the heap, so editing one entry (the "edit entry"
                // sheet) silently moved it to the end of the list.
                //
                // The tie-break DIRECTION is a PRODUCT DECISION: chronological
                // load order, oldest-logged first within a day. That is NOT
                // the same rule the merge lookup below reuses `desc` for —
                // that `findFirst` picks which row ABSORBS a merge ("the
                // newest match wins"), a question about which row is right to
                // grow, not about what order a human wants to read their own
                // day back in. Copying its direction here would show today's
                // last-logged meal at the TOP of the list, above the
                // breakfast the user typed in first — backwards from what the
                // diary looks like today, where entries stack in the order
                // they were entered. `createdAt: 'asc'` (then `id: 'asc'` for
                // the residual tie, e.g. a batch insert sharing one `now()`)
                // keeps that order. Newer DAYS still come first — `date: 'desc'`
                // is untouched — this only decides the order WITHIN a day.
                orderBy: [{ date: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
                skip: offset,
                take: limit,
            }),
            // Counted over the SAME where: a global total would tell the client
            // it is seeing 3 of 400 for a day that holds exactly 3.
            prisma.nutritionEntry.count({ where })
        ]);

        const pagination = buildPaginationMeta(offset, limit, total);
        res.json({ data: entries, pagination });
    } catch (err: any) {
        // Only the 500 path is generic. The 400 above keeps saying which bound
        // the caller got wrong: that is the caller's OWN input described back
        // to it, it is the only way a client can fix its request, and it
        // reveals nothing the client did not already send.
        console.error('Error fetching nutrition entries:', err);
        res.status(500).json({ error: { message: 'Failed to fetch nutrition entries' } });
    }
});

/**
 * What the locked section decided, carried back out to be answered.
 *
 * The HTTP status is chosen OUTSIDE the transaction, once it has committed.
 * Writing the response from inside would tell the caller its food was stored
 * while the commit could still fail, which is the same silent-success shape the
 * 404 below exists to prevent.
 *
 * `vanished` is the row that was there for the lookup and gone for the write.
 */
type MergeOutcome =
    | { kind: 'merged'; entry: NutritionEntry }
    | { kind: 'created'; entry: NutritionEntry }
    | { kind: 'vanished' };

// Create a new nutrition entry (with merge logic)
router.post('/', authMiddleware, async (req: Request, res: Response) => {
    const parseResult = CreateNutritionEntrySchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    const { foodItemId, foodName, grams, mealCategory, date, calories: pCalories, protein: pProtein, carbs: pCarbs, fat: pFat } = parseResult.data;
    const userId = req.user!.userId;

    // The window this entry may merge into an existing one within.
    //
    // The caller sends it, because a day is a LOCAL thing and the server has no
    // way to know which one the user means: 23:00 on the 30th in Buenos Aires
    // and 00:30 on the 31st are two different days that share one UTC day, and
    // a server-side start-of-day merged them into a single entry filed under
    // the first — so the second meal vanished from the day the diary showed it
    // on. Worse, it did so only when the server happened to run in UTC.
    //
    // It is the same window the client reads the diary back with, so there is
    // one definition of "day" and the two ends cannot disagree.
    let entryDate: Date;
    let mergeStart: Date;
    let mergeEnd: Date;
    try {
        // `date` is a bound too — it decides which day the entry is filed under
        // — and it was the one bound nobody parsed. `z.string()` accepts any
        // characters at all, and `new Date("garbage")` is an Invalid Date whose
        // every comparison is FALSE: both halves of the containment check below
        // read false, so an unparseable date sailed through the guard and
        // merged into whatever row the window matched. One parser for all three
        // bounds, so there is one definition of "an instant" on this route.
        //
        // zod defaults `date` to now, so it always has a value and parseBound
        // — which returns undefined only for an absent one — cannot here.
        entryDate = parseBound(date, 'date')!;
        const from = parseBound(req.body?.mergeFrom, 'mergeFrom');
        const to = parseBound(req.body?.mergeTo, 'mergeTo');
        if ((from === undefined) !== (to === undefined)) {
            throw new Error('mergeFrom and mergeTo must be sent together');
        }
        if (from && to) {
            if (from > to) throw new Error('mergeFrom must not be after mergeTo');
            if (to.getTime() - from.getTime() > MAX_MERGE_WINDOW_MS) {
                throw new Error('the merge window must not be wider than 28 hours');
            }
            // An entry filed outside the window it merges within would search a
            // day it does not belong to — the very defect this window fixes.
            //
            // The window is HALF-OPEN: [from, to). `to` is the first instant of
            // the NEXT day, so an entry stamped exactly there belongs to that
            // day and not to this one. Accepting it would file the same instant
            // under two consecutive days, and the client — which reads each day
            // back with the very same bounds — would show that meal twice.
            if (entryDate < from || entryDate >= to) {
                // `date` is optional and defaults to now, so a caller logging
                // food for a day that is not today and leaving it off is told
                // its date is wrong about a date it never sent. Name the real
                // problem, which is the missing field and not the window.
                throw new Error(
                    req.body?.date === undefined
                        ? 'date must fall inside the merge window; no date was sent, so it defaulted to now'
                        : 'date must fall inside the merge window'
                );
            }
            mergeStart = from;
            mergeEnd = to;
        } else {
            // Legacy path, for a caller that sends no window: the server's own
            // calendar day. Kept so an older bundle goes on working, and built
            // as the SAME half-open interval as the window above — the search
            // below is exclusive at the top for both, so an end named
            // 23:59:59.999 would silently stop a millisecond short of the day
            // and stack a second row for the last meal of the night.
            //
            // Both bounds come straight from the calendar fields rather than
            // from a mutated copy: bumping the day first and zeroing the clock
            // afterwards carries the entry's time of day across the day change,
            // and a time of day that lands in a spring-forward GAP resolves
            // forward past midnight, slipping the date an extra day. That was
            // measured producing a 47-hour "day" — which the 48-hour cap above
            // would wave straight through.
            mergeStart = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate(), 0, 0, 0, 0);
            mergeEnd = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate() + 1, 0, 0, 0, 0);
        }
    } catch (err: any) {
        res.status(400).json({ error: { message: 'Validation error', details: err.message } });
        return;
    }

    try {
        let calories = pCalories ?? 0;
        let protein = pProtein ?? 0;
        let carbs = pCarbs ?? 0;
        let fat = pFat ?? 0;

        // Calculate macros only if not provided
        if (foodItemId && pCalories === undefined) {
            const foodItem = await prisma.foodItem.findUnique({ where: { id: foodItemId } });
            if (foodItem) {
                const ratio = foodItem.isGramBased ? (grams / 100) : grams;
                calories = (foodItem.caloriesPer100g || 0) * ratio;
                protein = (foodItem.proteinPer100g || 0) * ratio;
                carbs = (foodItem.carbsPer100g || 0) * ratio;
                fat = (foodItem.fatPer100g || 0) * ratio;

                // The serving is bounded, but the food's own per-100g columns are
                // unbounded Floats, so the product is checked where it is made
                // rather than only where its inputs come in. An Infinity here is
                // bound by Prisma as SQL NULL, and the merge's COALESCE then
                // ERASES the column instead of adding to it — the guarantee has
                // to hold whatever is in the FoodItem row.
                if (![calories, protein, carbs, fat].every(Number.isFinite)) {
                    res.status(400).json({
                        error: { message: 'Validation error', details: 'grams is too large for this food: its macros overflow' }
                    });
                    return;
                }
            }
        }

        // Look, then write, with nobody else looking at the same thing in
        // between.
        //
        // The row lock the merge hides behind only exists once there IS a row.
        // Two requests that both look at an empty window both find nothing and
        // both create — measured: six concurrent posts of one serving each
        // produced SIX rows, each answering 201. No grams are lost, so this is
        // the milder half of the race, but it is duplicate rows the user can
        // see, on precisely the input the merge exists to fold together.
        //
        // A TRANSACTION-SCOPED ADVISORY LOCK, not a unique constraint. The "day"
        // is caller-supplied and is not a column, so there is nothing to put a
        // constraint ON without adding a derived column, backfilling it and
        // turning the merge into an upsert — a schema redesign, and a different
        // change. `pg_advisory_xact_lock` is released when the transaction ends,
        // committed or rolled back, so no path can leak it.
        //
        // The key is the three things the lookup matches by, so two users, two
        // meals or two foods never wait on each other; only the requests that
        // could actually collide serialise, and they hold the lock for one SELECT
        // and one write. `hashtext` is a 32-bit hash, so two unrelated keys can
        // land on the same lock — that costs a little waiting and never
        // correctness, which is the right direction for a hash to be wrong in.
        //
        // KNOWN GAP, stated rather than papered over: the lookup matches
        // `foodItemId OR foodName`, so two requests carrying DIFFERENT
        // foodItemIds but the SAME foodName can match each other's rows while
        // taking different keys, and still race. Keying on both would mean two
        // locks and an ordering rule to avoid deadlocking them against each
        // other; the honest fix is to the matching rule, which is its own change.
        const lockKey = `nutrition-merge|${userId}|${mealCategory}|${foodItemId ?? foodName}`;

        const outcome = await prisma.$transaction(async (tx): Promise<MergeOutcome> => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

            // Search for existing entry to merge
            const existingEntry = await tx.nutritionEntry.findFirst({
                where: {
                    userId,
                    mealCategory,
                    // Half-open, matching the window the caller sent and the
                    // range the GET filter applies: `mergeEnd` is the first
                    // instant of the next day, so a row stamped there belongs to
                    // that day. Reaching it would merge tomorrow's first meal
                    // into today's row, and the meal would then vanish from the
                    // day the diary shows it on — the exact loss this window
                    // exists to prevent.
                    date: {
                        gte: mergeStart,
                        lt: mergeEnd
                    },
                    // Match by ID if available, otherwise by Name (for custom entries)
                    OR: [
                        { foodItemId: foodItemId || 'none' },
                        { foodName: foodName }
                    ]
                },
                // More than one row can match — a retry, an older bundle, a row
                // that predates the window. Without an ORDER BY the database is
                // free to return whichever it reaches first, so which row
                // absorbs the merge would change between runs. The newest match
                // wins, by decision.
                //
                // `date` ALONE is not that decision, because `date` is not
                // unique here and among exactly the rows that matter it is
                // usually constant: the diary sends `selectedDate.toISOString()`
                // from a `useState(new Date())` captured once at mount, so every
                // entry a user logs in one sitting on one day carries the
                // identical millisecond. ORDER BY on a constant key is no order
                // at all, and the planner was free again — measured: the OLDER
                // of two rows sharing a date absorbed the merge.
                //
                // `createdAt` states the same rule at a grain that can tell
                // those rows apart. `id` follows it because `createdAt` is a
                // `timestamp(3)`, so two rows written inside one millisecond tie
                // there too; it is unique, which is what makes the three keys
                // together a TOTAL order and the choice reproducible.
                orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
            });

            if (existingEntry) {
                // MERGE: add to the existing entry.
                //
                // The addition happens IN THE DATABASE, not here. Reading the
                // row and writing back a sum computed in JavaScript loses every
                // update but the last when two requests overlap: eight
                // concurrent posts of 100 g each were measured storing 300 g,
                // and answering 200 OK to all eight. Adding in a single
                // statement puts the sum behind the row lock, which makes it
                // exact however many requests overlap. The advisory lock above
                // closes the other half, where there is no row to lock yet.
                //
                // Spelled out in SQL rather than with Prisma's `increment`
                // because the four macro columns are NULLABLE and `increment`
                // compiles to a bare `x = x + n`: in SQL NULL + 5 is NULL, so a
                // row with no protein recorded came back with its protein ERASED
                // instead of set to the serving just logged. COALESCE keeps the
                // "a missing macro counts as zero" rule the read-modify-write
                // had, without giving up the row lock. RETURNING reads back the
                // row the same statement wrote, so the response cannot disagree
                // with what was stored.
                //
                // On `tx`, not on the global client: a write that ran outside
                // this transaction would not be covered by the lock the
                // transaction holds, and the serialisation would be a comment
                // rather than a guarantee.
                //
                // The userId in the WHERE is redundant with the lookup above,
                // and stays anyway: a statement that writes a user's row should
                // say whose row it is, instead of borrowing that guarantee from
                // a query forty lines away that a later change is free to alter.
                const [updated] = await tx.$queryRaw<NutritionEntry[]>`
                    UPDATE "NutritionEntry"
                    SET "grams"    = "grams" + ${grams}::double precision,
                        "calories" = COALESCE("calories", 0) + ${calories}::double precision,
                        "protein"  = COALESCE("protein", 0)  + ${protein}::double precision,
                        "carbs"    = COALESCE("carbs", 0)    + ${carbs}::double precision,
                        "fat"      = COALESCE("fat", 0)      + ${fat}::double precision
                    WHERE "id" = ${existingEntry.id}
                      AND "userId" = ${userId}
                    RETURNING *
                `;
                // The UPDATE can match NOTHING: the row found a moment ago may
                // have been deleted in the gap by another request. Nothing was
                // stored, so this must not read as success. Left unchecked,
                // `updated` is undefined, JSON.stringify drops the key, and the
                // wire body is exactly {"merged":true} with a 200 — the client
                // reads `result?.data ?? result`, sees a truthy object and tells
                // the user the food was added. Food the user logged, gone
                // without a word.
                if (!updated) return { kind: 'vanished' };
                return { kind: 'merged', entry: updated };
            }

            // CREATE: New entry
            const entry = await tx.nutritionEntry.create({
                data: {
                    userId,
                    foodItemId,
                    foodName,
                    grams,
                    mealCategory,
                    calories,
                    protein,
                    carbs,
                    fat,
                    date: entryDate,
                    status: 'COMPLETED'
                }
            });
            return { kind: 'created', entry };
        });

        // The status codes live out here, after the transaction has COMMITTED.
        // Answering from inside it would tell the caller its food was stored
        // while the commit could still fail.
        if (outcome.kind === 'vanished') {
            res.status(404).json({ error: { message: 'Entry not found' } });
            return;
        }
        if (outcome.kind === 'merged') {
            res.json({ data: outcome.entry, merged: true });
            return;
        }
        res.status(201).json({ data: outcome.entry, merged: false });
    } catch (err: any) {
        console.error('Error saving nutrition entry:', err);
        res.status(500).json({ error: { message: 'Failed to save nutrition entry' } });
    }
});

// PATCH: Update a nutrition entry (grams, macros or category)
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
    const parseResult = UpdateNutritionEntrySchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    const userId = req.user!.userId;
    const entryId = req.params.id as string;
    const { grams: pGrams, mealCategory: pMealCategory, calories: pCalories, protein: pProtein, carbs: pCarbs, fat: pFat } = parseResult.data;

    try {
        const existing = await prisma.nutritionEntry.findUnique({
            where: { id: entryId },
            include: { foodItem: true }
        });

        if (!existing || existing.userId !== userId) {
            res.status(404).json({ error: { message: 'Entry not found' } });
            return;
        }

        const grams = pGrams || existing.grams;
        let macros = {
            calories: pCalories !== undefined ? pCalories : existing.calories,
            protein: pProtein !== undefined ? pProtein : existing.protein,
            carbs: pCarbs !== undefined ? pCarbs : existing.carbs,
            fat: pFat !== undefined ? pFat : existing.fat
        };

        // Recalculate if grams changed and macros NOT explicitly provided
        if (pGrams && pCalories === undefined && existing.foodItem) {
            const ratio = existing.foodItem.isGramBased ? (grams / 100) : grams;
            macros = {
                calories: (existing.foodItem.caloriesPer100g || 0) * ratio,
                protein: (existing.foodItem.proteinPer100g || 0) * ratio,
                carbs: (existing.foodItem.carbsPer100g || 0) * ratio,
                fat: (existing.foodItem.fatPer100g || 0) * ratio
            };

            // The same product, so the same guard the create path carries. The
            // serving is bounded by MAX_GRAMS, but the food's own per-100g
            // columns are unbounded Floats written by a different route, so a
            // legal serving of a poisoned food still overflows to Infinity —
            // and Prisma binds Infinity as SQL NULL, so the write does not fail,
            // it ERASES the column. Measured before this guard existed:
            // `PATCH { grams: 100000 }` against a food holding
            // `caloriesPer100g: 1e308` answered 200 with `calories: null`
            // stored over a row that held 1000 kcal, and the number was gone.
            if (!Object.values(macros).every((m) => m === null || Number.isFinite(m))) {
                res.status(400).json({
                    error: { message: 'Validation error', details: 'grams is too large for this food: its macros overflow' }
                });
                return;
            }
        }

        const updated = await prisma.nutritionEntry.update({
            where: { id: entryId },
            data: {
                grams,
                mealCategory: pMealCategory || existing.mealCategory,
                ...macros
            }
        });

        res.json({ data: updated });
    } catch (err: any) {
        console.error('Error updating nutrition entry:', err);
        res.status(500).json({ error: { message: 'Failed to update nutrition entry' } });
    }
});

// DELETE: Remove a nutrition entry
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const entryId = req.params.id as string;

    try {
        const existing = await prisma.nutritionEntry.findUnique({
            where: { id: entryId }
        });

        if (!existing || existing.userId !== userId) {
            res.status(404).json({ error: { message: 'Entry not found' } });
            return;
        }

        await prisma.nutritionEntry.delete({ where: { id: entryId } });
        res.json({ message: 'Entry deleted successfully' });
    } catch (err: any) {
        console.error('Error deleting nutrition entry:', err);
        res.status(500).json({ error: { message: 'Failed to delete entry' } });
    }
});

export default router;
