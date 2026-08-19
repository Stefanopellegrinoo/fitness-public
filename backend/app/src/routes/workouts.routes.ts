import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authMiddleware } from '../middlewares/auth.middleware';
import { asyncHandler } from '../middlewares/error.middleware';
import { parsePaginationParams, buildPaginationMeta } from '../adapters/pagination.adapter';
import { workoutService } from '../services/workouts.service';
import { z } from 'zod';

const router = Router();

const SetTypeEnum = z.enum(['WARMUP', 'WORKING', 'TOP', 'BACKOFF', 'DROP', 'MYOREP', 'RESTPAUSE', 'AMRAP']);

const WorkoutSetSchema = z.object({
    exerciseId: z.string().uuid(),
    setNumber: z.number().int().positive(),
    weightKg: z.number().nonnegative(),
    reps: z.number().int().nonnegative(),
    rpe: z.number().min(1).max(10).optional(),
    setType: SetTypeEnum.optional(),
    isWarmup: z.boolean().optional(), // legacy input, mapped to setType
}).transform((data) => {
    const setType = data.setType ?? (data.isWarmup ? 'WARMUP' as const : 'WORKING' as const);
    return { ...data, setType, isWarmup: setType === 'WARMUP' };
});

// `notes` used to be declared here, type-checked, destructured by the handler and
// then never passed to the service — accepted and dropped in silence. Honouring it
// instead was considered and rejected: a start that RESUMES has no new row to put
// the note on, which leaves either writing over the live session's notes (a start
// silently editing existing user data) or dropping it again on exactly the path
// the routineDayId validation exists to make honest.
//
// `.strict()` is what makes the removal mean anything. A plain z.object STRIPS
// unknown keys — measured — so deleting the field alone would have left the same
// silent discard with a shorter schema. It also closes the wider hole `notes` was
// only one instance of: a typo in `routineId` used to start a routine-less workout
// and report 201. No client is broken by it — the only caller's `startWorkout`
// takes a `notes` argument that both of its call sites pass as `undefined`, and
// JSON.stringify omits undefined keys, so the wire body never carried it.
const StartWorkoutSchema = z.object({
    routineId: z.string().uuid().optional(),
    routineDayId: z.string().uuid().optional(),
    clientDay: z.enum(['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO']).optional(),
}).strict();

// Its sibling POST /:id/sets has validated with Zod all along; this route checked
// `if (!exerciseId)` and handed anything truthy to Prisma. Measured against an OPEN
// session (the open-session guard hides it on a closed one): a non-uuid string reached
// Postgres and failed the uuid cast, and an object or array was rejected by Prisma
// itself — all four came back 500 for what is plainly a bad request.
// Not `.strict()`, matching `WorkoutSetSchema` next to it: nothing here needs to
// reject an extra key, and a guarantee with no test that dies for it is either
// uncovered or code that should not exist.
const LinkExerciseSchema = z.object({
    exerciseId: z.string().uuid(),
});

const UpdateWorkoutSchema = z.object({
    notes: z.string().optional(),
    routineId: z.string().uuid().optional(),
});

// GET: Current active session (if any)
router.get('/active', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const active = await workoutService.getActiveWorkout(req.user!.userId);
    res.json({ data: active });
}));

// POST: Start a new workout session (or resume active)
router.post('/start', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const parseResult = StartWorkoutSchema.safeParse(req.body);
    
    if (!parseResult.success) {
        res.status(400).json({ 
            error: { 
                message: 'Validation error', 
                details: parseResult.error.flatten() 
            } 
        });
        return;
    }

    const { routineId, clientDay, routineDayId } = parseResult.data;

    try {
        const session = await workoutService.startWorkout(req.user!.userId, routineId, clientDay, routineDayId);
        res.status(201).json({ data: session });
    } catch (err: any) {
        if (err?.message === 'ROUTINE_DAY_MISMATCH') {
            res.status(400).json({ error: { message: 'routineDayId does not belong to the routine' } });
            return;
        }
        // The day lookup is scoped by routineId, so on its own a routineDayId cannot
        // be applied to anything. It used to be dropped in silence and answered 201.
        if (err?.message === 'ROUTINE_DAY_WITHOUT_ROUTINE') {
            res.status(400).json({ error: { message: 'routineDayId requires routineId' } });
            return;
        }
        if (err?.message === 'ROUTINE_NOT_FOUND') {
            res.status(404).json({ error: { message: 'Routine not found' } });
            return;
        }
        // Concurrent starts converged on a session for a different routine. The
        // request is not satisfiable as asked, and answering 201 with someone
        // else's routine would look like success. 409 lets the client retry.
        if (err?.message === 'START_ROUTINE_CONFLICT') {
            res.status(409).json({
                error: { message: 'Another workout was just started for a different routine' }
            });
            return;
        }
        throw err;
    }
}));

// The distinction is what the client acts on: 404 means the id is not the caller's
// to write to and retrying is pointless, 409 means the target is real but its session
// is finished — the client should drop its stale session id and start a new workout.
// Left unmapped, both reach the generic handler as a 500 and look identical.
function respondToSessionWriteError(err: any, res: Response): boolean {
    if (err?.message === 'SESSION_NOT_FOUND') {
        res.status(404).json({ error: { message: 'Session not found' } });
        return true;
    }
    if (err?.message === 'SET_NOT_FOUND') {
        res.status(404).json({ error: { message: 'Set not found' } });
        return true;
    }
    if (err?.message === 'SESSION_CLOSED') {
        res.status(409).json({ error: { message: 'This workout session is already finished' } });
        return true;
    }
    return false;
}

// A set is writable only through a session the caller owns and has not finished.
// The two 404 cases stay merged: a set that is not the caller's must be
// indistinguishable from one that does not exist, or the answer confirms the id to
// anyone enumerating uuids.
async function assertSetIsWritable(setId: string, userId: string): Promise<void> {
    const set = await prisma.workoutSet.findUnique({
        where: { id: setId },
        include: { session: true }
    });

    if (!set || set.session.userId !== userId) throw new Error('SET_NOT_FOUND');
    if (set.session.finishedAt) throw new Error('SESSION_CLOSED');
}

// POST: Link an exercise to the session (dynamic addition)
router.post('/:id/exercises', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const parseResult = LinkExerciseSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    try {
        const linked = await workoutService.linkExerciseToSession(req.params.id as string, req.user!.userId, parseResult.data.exerciseId);
        res.status(201).json({ data: linked });
    } catch (err: any) {
        if (!respondToSessionWriteError(err, res)) throw err;
    }
}));

// POST: Record a set in an active session
router.post('/:id/sets', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const parseResult = WorkoutSetSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    try {
        const set = await workoutService.addWorkoutSet(req.params.id as string, req.user!.userId, parseResult.data);
        res.status(201).json({ data: set });
    } catch (err: any) {
        if (!respondToSessionWriteError(err, res)) throw err;
    }
}));

// POST: Finish a workout session
//
// Idempotent by design: a session already finished answers 200 with its untouched row,
// not the 409 the other session writes use. Only SESSION_NOT_FOUND can come out of the
// service here, and it must not reach the generic handler — an unmapped Prisma P2025
// surfaced as a 500, telling the client to retry an id that will never resolve.
router.post('/:id/finish', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    try {
        const session = await workoutService.finishWorkout(req.params.id as string, req.user!.userId);
        res.json({ data: session });
    } catch (err: any) {
        if (!respondToSessionWriteError(err, res)) throw err;
    }
}));

// DELETE: Remove a set from an active session
router.delete('/sets/:id', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const setId = req.params.id as string;

    try {
        await assertSetIsWritable(setId, req.user!.userId);
        await prisma.workoutSet.delete({ where: { id: setId } });
        res.json({ message: 'Set deleted successfully' });
    } catch (err: any) {
        if (!respondToSessionWriteError(err, res)) throw err;
    }
}));

// PATCH: Update a specific set (weight, reps, rpe)
router.patch('/sets/:id', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const setId = req.params.id as string;

    const UpdateSetSchema = z.object({
        weightKg: z.number().nonnegative().optional(),
        reps: z.number().int().nonnegative().optional(),
        rpe: z.number().min(1).max(10).optional(),
        setType: SetTypeEnum.optional(),
        isWarmup: z.boolean().optional(),
    }).transform((data) => {
        if (data.setType !== undefined) return { ...data, isWarmup: data.setType === 'WARMUP' };
        if (data.isWarmup !== undefined) return { ...data, setType: data.isWarmup ? 'WARMUP' as const : 'WORKING' as const };
        return data;
    });

    const parseResult = UpdateSetSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    try {
        await assertSetIsWritable(setId, req.user!.userId);
        const updated = await prisma.workoutSet.update({
            where: { id: setId },
            data: parseResult.data
        });
        res.json({ data: updated });
    } catch (err: any) {
        if (!respondToSessionWriteError(err, res)) throw err;
    }
}));

// PATCH: Update an existing workout session (notes, routineId)
router.patch('/:id', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const parseResult = UpdateWorkoutSchema.safeParse(req.body);
    if (!parseResult.success) {
        res.status(400).json({ error: { message: 'Validation error', details: parseResult.error.flatten() } });
        return;
    }

    const userId = req.user!.userId;
    const sessionId = req.params.id as string;

    // Ownership of the SESSION decides first, and a session that is not the caller's is
    // reported exactly like one that does not exist. Only once the caller is known to own
    // it does its state, or the payload, get to produce a different answer.
    const existing = await prisma.workoutSession.findUnique({ where: { id: sessionId } });
    if (!existing || existing.userId !== userId) {
        res.status(404).json({ error: { message: 'Workout session not found' } });
        return;
    }

    // A finished workout is history. Rewriting its notes or repointing its routine edits a
    // past session, which is the same door `POST /:id/sets` and the set routes already shut.
    if (existing.finishedAt) {
        res.status(409).json({ error: { message: 'This workout session is already finished' } });
        return;
    }

    // The routineId is an FK the client supplies, and owning the session says nothing about
    // owning the routine. Without this, writing someone else's routineId here comes back out
    // of every read that includes the relation — `GET /workouts/sessions`, `getActiveWorkout`
    // and a resumed start all do — turning a write hole into a cross-tenant read.
    if (parseResult.data.routineId) {
        try {
            await workoutService.assertRoutineOwnership(parseResult.data.routineId, userId);
        } catch (err: any) {
            if (err?.message !== 'ROUTINE_NOT_FOUND') throw err;
            res.status(404).json({ error: { message: 'Routine not found' } });
            return;
        }
    }

    const updated = await prisma.workoutSession.update({
        where: { id: sessionId },
        data: parseResult.data,
        include: { sets: { include: { exercise: true }, orderBy: { setNumber: 'asc' } } }
    });

    res.json({ data: updated });
}));

// Get user's workout sessions
router.get('/sessions', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const { offset, limit } = parsePaginationParams(
        req.query.offset as string | undefined,
        req.query.limit as string | undefined
    );
    const routineId = req.query.routineId as string | undefined;

    // A session with no sets is not a workout. Everything else in this codebase
    // already says so — the stale sweep and startWorkout's step 5 both DELETE an
    // empty session rather than close it, and `sets: { none: {} }` is the exact
    // predicate they use. History is the one place that still disagreed, and its
    // only caller renders every row it gets back: an empty session showed up as a
    // "0 series completadas" entry AND as a dip to zero on the volume chart.
    //
    // Filtering on READ rather than stopping the writers, because the writers are
    // not one place: `finishWorkout` still produces these (start, log nothing, tap
    // Finalizar — measured), and that one is a deliberate user action that returns
    // its own row to the client, so it is deliberately left alone. A read filter
    // does not care which path wrote the row, or when.
    //
    // ONE object for both queries below on purpose: `total` feeds hasMore and
    // pageCount, so a filter applied to the rows but not to the count would promise
    // the client pages that come back short. Typed rather than `any` so a mistyped
    // relation filter is a compile error instead of a runtime one.
    const where: Prisma.WorkoutSessionWhereInput = {
        userId: req.user!.userId,
        sets: { some: {} },
    };
    if (routineId) {
        where.routineId = routineId;
    }

    const [sessions, total] = await Promise.all([
        prisma.workoutSession.findMany({
            where,
            include: {
                routine: true,
                sets: {
                    include: { exercise: true },
                    orderBy: { setNumber: 'asc' }
                }
            },
            orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
            skip: offset,
            take: limit,
        }),
        prisma.workoutSession.count({
            where
        })
    ]);

    const pagination = buildPaginationMeta(offset, limit, total);
    res.json({ data: sessions, pagination });
}));

// GET: Exercise history (last session sets)
router.get('/history/exercise/:exerciseId', authMiddleware, asyncHandler(async (req: Request, res: Response) => {
    const exerciseId = req.params.exerciseId as string;
    const currentSessionId = req.query.currentSessionId as string | undefined;
    const history = await workoutService.getLastExerciseSessionSets(req.user!.userId, exerciseId, currentSessionId);
    res.json({ data: history });
}));

export default router;
