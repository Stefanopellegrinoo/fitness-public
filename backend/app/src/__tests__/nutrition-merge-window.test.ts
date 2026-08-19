import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * The window POST /api/nutrition merges within.
 *
 * Logging the same food, in the same meal, on the same DAY adds to the entry
 * that is already there instead of stacking a second row. "The same day" is the
 * user's local day, and only the client knows which one that is — so the client
 * sends the window, exactly the one it later reads back with. Read and write
 * agree on where a day starts because there is a single definition of it.
 *
 * Every instant below is written in UTC and every window is explicit, so these
 * assertions hold identically under TZ=UTC and under TZ=America/Buenos_Aires.
 */
describe('POST /api/nutrition merge window', () => {
  let userId: string;
  let otherUserId: string;
  let authToken: string;
  let otherToken: string;
  const stamp = Date.now();
  let seq = 0;
  // Food items outlive the per-test entry cleanup, so they are tracked and
  // removed by hand at the end. The database is disposable, not a dumping ground.
  const foodItemIds: string[] = [];

  // 23:00 on the 30th and 00:30 on the 31st in Buenos Aires. Two different
  // local days, ONE UTC day: the shape that made the server-side window merge
  // entries the diary then showed on different days.
  const laNoche30 = '2026-07-31T02:00:00.000Z';
  const laMadrugada31 = '2026-07-31T03:30:00.000Z';

  // The Buenos Aires day of the 30th, and of the 31st.
  //
  // Each window is HALF-OPEN: it ends where the next day BEGINS, not at a
  // 23:59:59.999 of its own. That is why `dia30.mergeTo` and `dia31.mergeFrom`
  // are the same string — the two days meet exactly, with no instant left over
  // and none claimed twice.
  const dia30 = { mergeFrom: '2026-07-30T03:00:00.000Z', mergeTo: '2026-07-31T03:00:00.000Z' };
  const dia31 = { mergeFrom: '2026-07-31T03:00:00.000Z', mergeTo: '2026-08-01T03:00:00.000Z' };

  // The TOKYO day of the 31st (UTC+9), and two instants inside it. It matches
  // neither the server's calendar day nor UTC's — under either timezone those
  // two instants fall on different days — so a server that re-derived the day
  // instead of honouring the window splits them whichever clock it keeps.
  const diaTokio31 = { mergeFrom: '2026-07-30T15:00:00.000Z', mergeTo: '2026-07-31T15:00:00.000Z' };
  const tokioTemprano = '2026-07-30T16:00:00.000Z';
  const tokioTarde = '2026-07-31T10:00:00.000Z';

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `nutri.merge.${stamp}@example.com`, password: 'password123', name: 'Merge Tester' },
    });
    const other = await prisma.user.create({
      data: { email: `nutri.merge.other.${stamp}@example.com`, password: 'password123', name: 'Other' },
    });
    userId = user.id;
    otherUserId = other.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    otherToken = authService.generateTokens({ userId: other.id, email: other.email }).accessToken;
  });

  afterAll(async () => {
    await prisma.nutritionEntry.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.foodItem.deleteMany({ where: { id: { in: foodItemIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  beforeEach(async () => {
    await prisma.nutritionEntry.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  });

  // A distinct name per test: the merge also matches by name, so two tests
  // sharing one would merge into each other's rows.
  const unName = () => `merge ${stamp} ${seq++}`;

  // One serving, macros included. Every macro is asserted on every merge, not
  // just grams and calories: a merge that added grams while OVERWRITING protein
  // would still look right from the two columns the assertions used to read.
  const RACION = { grams: 100, calories: 100, protein: 5, carbs: 10, fat: 2 };
  // What n merged servings must add up to. Each value is exact in binary
  // floating point, so the totals are too, however many are summed.
  const raciones = (n: number) => ({
    grams: RACION.grams * n,
    calories: RACION.calories * n,
    protein: RACION.protein * n,
    carbs: RACION.carbs * n,
    fat: RACION.fat * n,
  });

  const post = (body: Record<string, unknown>, token = authToken) =>
    request(app)
      .post('/api/nutrition')
      .set('Cookie', [`auth_token=${token}`])
      .send({ foodName: 'sin nombre', mealCategory: 'Desayuno', ...RACION, ...body });

  const filas = (foodName: string) =>
    prisma.nutritionEntry.findMany({ where: { userId, foodName }, orderBy: { date: 'asc' } });

  // Seeds a row directly, bypassing the route, so a test can set up the state
  // it needs to observe without that setup going through the merge itself.
  const sembrar = (foodName: string, date: string) =>
    prisma.nutritionEntry.create({
      data: { userId, foodName, mealCategory: 'Desayuno', ...RACION, date: new Date(date), status: 'COMPLETED' },
    });

  /**
   * Forces the merge's LOOKUP to hand back a row of the test's choosing.
   *
   * The lookup moved onto the TRANSACTION client when the create-create race was
   * closed, so `vi.spyOn(prisma.nutritionEntry, 'findFirst')` no longer observes
   * it: `tx.nutritionEntry` is a delegate of its own, not the global one. The
   * interception moves one seam out — wrap `$transaction`, install the one-shot
   * spy on the client it is about to hand the callback, and then let the REAL
   * transaction run, so the advisory lock, the raw UPDATE and the commit all
   * still happen exactly as they do in production.
   *
   * Same interleaving, same assertions; only where the spy attaches changed.
   */
  const interceptarBusqueda = (
    falsa: (real: (args: any) => Promise<any>, args: any) => Promise<any>
  ) => {
    const transaccionReal = prisma.$transaction.bind(prisma) as any;
    return vi.spyOn(prisma, '$transaction').mockImplementationOnce(((fn: any, opts: any) =>
      transaccionReal(async (tx: any) => {
        const real = tx.nutritionEntry.findFirst.bind(tx.nutritionEntry);
        vi.spyOn(tx.nutritionEntry, 'findFirst').mockImplementationOnce(((args: any) => falsa(real, args)) as never);
        return fn(tx);
      }, opts)) as never);
  };

  // The same, with `createdAt` stated instead of defaulted. Two rows written a
  // millisecond apart would otherwise be indistinguishable on the column the
  // tie-break reads, which is precisely the thing under test.
  const sembrarCreadaEn = (foodName: string, date: string, createdAt: string) =>
    prisma.nutritionEntry.create({
      data: {
        userId, foodName, mealCategory: 'Desayuno', ...RACION,
        date: new Date(date), createdAt: new Date(createdAt), status: 'COMPLETED',
      },
    });

  it('merges two entries that fall inside the same window', async () => {
    const foodName = unName();
    await post({ foodName, date: laNoche30, ...dia30 });
    const second = await post({ foodName, date: '2026-07-30T15:00:00.000Z', ...dia30 });

    expect(second.status).toBe(200);
    expect(second.body.merged).toBe(true);

    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(2));
  });

  /**
   * GAP G. Both instants land on the 31st in UTC, so a server that derived the
   * day itself merged them — and the second meal silently vanished from the day
   * the diary showed it on. The windows say they are different days, and the
   * windows are what counts.
   */
  it('does not merge across two windows that share a UTC day', async () => {
    const foodName = unName();
    const first = await post({ foodName, date: laNoche30, ...dia30 });
    const second = await post({ foodName, date: laMadrugada31, ...dia31 });

    expect(first.body.merged).toBe(false);
    expect(second.body.merged).toBe(false);
    expect(second.status).toBe(201);

    const rows = await filas(foodName);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.grams)).toEqual([100, 100]);
  });

  /**
   * A day that belongs to neither clock in the room. Under UTC and under
   * Buenos Aires alike these two instants fall on different calendar days, so
   * only a server that takes the window as given merges them — the guarantee
   * is that the window WINS, not that it happens to agree with the server.
   */
  it('merges inside a window that is nobody\'s calendar day but the caller\'s', async () => {
    const foodName = unName();
    await post({ foodName, date: tokioTemprano, ...diaTokio31 });
    const second = await post({ foodName, date: tokioTarde, ...diaTokio31 });

    expect(second.body.merged).toBe(true);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(2));
  });

  /** The same foreign window, reached from the other end. */
  it('merges backwards inside that same foreign window', async () => {
    const foodName = unName();
    await post({ foodName, date: tokioTarde, ...diaTokio31 });
    const second = await post({ foodName, date: tokioTemprano, ...diaTokio31 });

    expect(second.body.merged).toBe(true);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(2));
  });

  /**
   * The window has to close at BOTH ends. Searching only forwards from its
   * start would reach an entry that belongs to a later day — the same lost
   * meal as the test above, just from the other side.
   */
  it('does not merge into an entry that sits after the window', async () => {
    const foodName = unName();
    await post({ foodName, date: laMadrugada31, ...dia31 });
    const second = await post({ foodName, date: laNoche30, ...dia30 });

    expect(second.body.merged).toBe(false);
    expect(await filas(foodName)).toHaveLength(2);
  });

  /**
   * The mirror of the test above: a window that straddles UTC midnight merges
   * both sides of it. Together they pin that the window is honoured literally
   * and never re-derived from the timestamp.
   */
  it('merges across UTC midnight when the window spans it', async () => {
    const foodName = unName();
    await post({ foodName, date: '2026-07-30T23:30:00.000Z', ...dia30 });
    const second = await post({ foodName, date: '2026-07-31T01:00:00.000Z', ...dia30 });

    expect(second.body.merged).toBe(true);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(2));
  });

  /**
   * The window reaches from the first instant of the day to the last one before
   * the next day begins — which is what "the whole day" means for a half-open
   * interval. Both extremes take part in the same merge, so a bound that
   * excluded its own first instant, or that stopped short of the last one it
   * holds, would split the day's first and last meal into two rows.
   */
  it('includes the first instant of the window and the last one inside it', async () => {
    const foodName = unName();
    const ultimo = new Date(Date.parse(dia30.mergeTo) - 1).toISOString();

    await post({ foodName, date: dia30.mergeFrom, ...dia30 });
    const second = await post({ foodName, date: ultimo, ...dia30 });

    expect(second.body.merged).toBe(true);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(2));
  });

  /**
   * The merge used to READ the row, add in JavaScript, then WRITE the sum back.
   * Eight concurrent posts of one serving each all read the same starting value
   * and all wrote their own total over each other: eight 200s, seven of them
   * lost, and every request answered 200 OK. Food the user logged simply was
   * not there.
   *
   * The addition belongs in the database, where the row lock makes it exact.
   *
   * This covers the LOST-UPDATE half. The CREATE-CREATE half is the test below.
   */
  it('does not lose servings when several posts race into the same window', async () => {
    const foodName = unName();
    // The row exists before the race, so every request below takes the merge
    // path. The create-race is the other half, and not what this pins.
    const primera = await post({ foodName, date: laNoche30, ...dia30 });
    expect(primera.status).toBe(201);

    const carrera = await Promise.all(
      Array.from({ length: 8 }, () => post({ foodName, date: laNoche30, ...dia30 }))
    );
    carrera.forEach((res) => {
      expect(res.status).toBe(200);
      expect(res.body.merged).toBe(true);
    });

    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(9));
  });

  /**
   * The CREATE-CREATE half of the same race, at an EMPTY table.
   *
   * The row lock the merge hides behind only exists once there IS a row. Two
   * requests that both look and both find nothing both go on to create one, and
   * the merge — whose entire purpose is that logging the same food twice adds to
   * one entry instead of stacking two — silently does not happen. MEASURED
   * before the fix: six concurrent posts of one serving each produced FOUR rows.
   * No grams are lost, which is why this is the least severe of the pair, but it
   * is duplicate rows the user can see, on the exact input the merge exists for.
   *
   * The lookup and the write are wrapped in a transaction that takes a
   * transaction-scoped Postgres ADVISORY LOCK first, keyed on the same three
   * things the lookup matches by. Not a unique constraint: the "day" is now
   * caller-supplied and is not a column, so there is nothing to put a constraint
   * ON without adding a derived column, backfilling it and turning the merge
   * into an upsert — a schema redesign, and a different change.
   *
   * A concurrency test that passes once may be luck, so this asserts the whole
   * shape rather than just the count: exactly one row, exactly one 201, the rest
   * 200-merged, and the total exact to the last macro.
   */
  it('creates exactly one row when several posts race into an empty window', async () => {
    const foodName = unName();
    const CORREDORES = 6;

    const carrera = await Promise.all(
      Array.from({ length: CORREDORES }, () => post({ foodName, date: laNoche30, ...dia30 }))
    );

    expect(carrera.filter((res) => res.status === 201)).toHaveLength(1);
    expect(carrera.filter((res) => res.status === 200 && res.body.merged === true)).toHaveLength(CORREDORES - 1);

    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(CORREDORES));
  });

  /**
   * The lock must not serialise more than it has to. Two different foods, or two
   * different meals, share nothing the merge could confuse, so they must still
   * run concurrently and each end up with their own single row — a lock keyed
   * too coarsely would be correct and useless.
   */
  it('still keeps races for different foods and meals apart', async () => {
    const uno = unName();
    const otro = unName();

    const carrera = await Promise.all([
      ...Array.from({ length: 3 }, () => post({ foodName: uno, date: laNoche30, ...dia30 })),
      ...Array.from({ length: 3 }, () => post({ foodName: otro, date: laNoche30, ...dia30 })),
      ...Array.from({ length: 3 }, () => post({ foodName: uno, mealCategory: 'Cena', date: laNoche30, ...dia30 })),
    ]);

    expect(carrera.filter((res) => res.status === 201)).toHaveLength(3);

    expect(await filas(otro)).toHaveLength(1);
    const deUno = await filas(uno);
    expect(deUno).toHaveLength(2);
    expect(deUno.map((r) => r.mealCategory).sort()).toEqual(['Cena', 'Desayuno']);
    deUno.forEach((r) => expect(r).toMatchObject(raciones(3)));
  });

  /**
   * The merge runs in two steps: find the row, then add to it. Another request
   * can delete that row in the gap — a second tab, or the user's own undo — and
   * then the UPDATE matches nothing.
   *
   * Nothing was stored, so the answer must not be a success. The read-modify-
   * write this replaced threw P2025 and surfaced as a 500; the raw UPDATE
   * quietly returns an empty result set, `data` disappears from the JSON body,
   * and the client reads `result?.data ?? result` and toasts "Alimento
   * agregado" over food that was never written. A silent 200 is the worst of
   * the three answers. 404: the row it was told to merge into is gone.
   *
   * The race is made deterministic here by deleting the row inside the gap
   * itself, which is the same interleaving, just without the timing luck.
   */
  it('answers 404 when the row it found is deleted before the merge lands', async () => {
    const foodName = unName();
    const primera = await post({ foodName, date: laNoche30, ...dia30 });
    expect(primera.status).toBe(201);

    const espia = interceptarBusqueda(async (buscarReal, args) => {
      const fila = await buscarReal(args);
      if (fila) await prisma.nutritionEntry.delete({ where: { id: fila.id } });
      return fila;
    });

    try {
      const res = await post({ foodName, date: laNoche30, ...dia30 });

      expect(res.status).toBe(404);
      expect(res.body.merged).not.toBe(true);
      expect(res.body.data).toBeUndefined();
    } finally {
      espia.mockRestore();
    }

    // And the serving is not invented anywhere else either.
    expect(await filas(foodName)).toHaveLength(0);
  });

  /**
   * The UPDATE must carry the tenancy check ITSELF.
   *
   * `WHERE "id" = ...` alone is safe only because a userId-scoped findFirst ran
   * forty lines above it, which is a guarantee that lives nowhere near the
   * statement it protects: a reader landing on that line has no way to tell,
   * and any future change to the lookup silently removes it. A statement that
   * writes a user's row should say whose row it is.
   *
   * The lookup is forced to hand back a row belonging to someone else, which is
   * exactly the state the missing predicate would fail to catch.
   */
  it('does not touch another user\'s row even when the lookup hands one over', async () => {
    const foodName = unName();
    const ajena = await prisma.nutritionEntry.create({
      data: { userId: otherUserId, foodName, mealCategory: 'Desayuno', ...RACION, date: new Date(laNoche30), status: 'COMPLETED' },
    });

    const espia = interceptarBusqueda(async () => ajena);

    try {
      const res = await post({ foodName, date: laNoche30, ...dia30 });
      expect(res.status).toBe(404);
      expect(res.body.merged).not.toBe(true);
    } finally {
      espia.mockRestore();
    }

    const intacta = await prisma.nutritionEntry.findUnique({ where: { id: ajena.id } });
    expect(intacta).toMatchObject(raciones(1));
  });

  /**
   * The macro columns are nullable, and the merge has always treated a missing
   * one as zero. Adding IN THE DATABASE must not quietly drop that: in SQL,
   * NULL + 5 is NULL, so a row with no protein recorded would come back with
   * its protein erased instead of set to the serving that was just logged.
   */
  it('treats a missing macro on the existing row as zero', async () => {
    const foodName = unName();
    await prisma.nutritionEntry.create({
      data: {
        userId, foodName, mealCategory: 'Desayuno', grams: RACION.grams,
        date: new Date(laNoche30), status: 'COMPLETED',
      },
    });

    const res = await post({ foodName, date: laNoche30, ...dia30 });

    expect(res.body.merged).toBe(true);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...raciones(1), grams: RACION.grams * 2 });
  });

  /**
   * More than one row can match a window — an older bundle, a retry, a row
   * created before this window existed. Which one absorbs the merge must be the
   * route's decision, not the database's: without an ORDER BY, Postgres is free
   * to return whichever row it reaches first, so the same request can grow a
   * different row from one day to the next. The newest match wins.
   */
  it('merges into the most recent matching row when several match', async () => {
    const foodName = unName();
    const vieja = await sembrar(foodName, '2026-07-30T04:00:00.000Z');
    const nueva = await sembrar(foodName, '2026-07-30T20:00:00.000Z');

    const res = await post({ foodName, date: '2026-07-30T22:00:00.000Z', ...dia30 });

    expect(res.body.merged).toBe(true);
    expect(res.body.data.id).toBe(nueva.id);

    const rows = await filas(foodName);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === nueva.id)).toMatchObject(raciones(2));
    expect(rows.find((r) => r.id === vieja.id)).toMatchObject(raciones(1));
  });

  /**
   * `ORDER BY date DESC` is not determinism when `date` is not unique — and on
   * this route it very often is not. The diary sends `selectedDate.toISOString()`
   * from a `useState(new Date())` captured ONCE at mount, so every entry a user
   * logs in one sitting on one day carries the IDENTICAL millisecond. Among
   * exactly the rows that matter, then, the sort key is constant and the
   * tie-break falls back to whatever the planner feels like returning — which is
   * the freedom the ORDER BY was added to take away.
   *
   * `createdAt` breaks the tie, and it is the same rule the comment already
   * claims, stated at a grain that can actually distinguish the rows: the newest
   * match wins.
   *
   * The two rows are seeded in the order that makes physical order the WRONG
   * answer — the one that must lose is written FIRST — so a scan handing back
   * heap order picks the older row and the test says so.
   */
  it('breaks a tie on date by which row was created last', async () => {
    const foodName = unName();
    const vieja = await sembrarCreadaEn(foodName, laNoche30, '2026-07-31T02:00:00.000Z');
    const nueva = await sembrarCreadaEn(foodName, laNoche30, '2026-07-31T09:00:00.000Z');

    const res = await post({ foodName, date: laNoche30, ...dia30 });

    expect(res.body.merged).toBe(true);
    expect(res.body.data.id).toBe(nueva.id);

    const rows = await filas(foodName);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === nueva.id)).toMatchObject(raciones(2));
    expect(rows.find((r) => r.id === vieja.id)).toMatchObject(raciones(1));
  });

  /**
   * `date` still outranks `createdAt`. A row logged for later in the day but
   * written to the database first must still be the one that wins, or the
   * tie-break has quietly become the whole rule.
   */
  it('still prefers the later date over the later creation', async () => {
    const foodName = unName();
    const tarde = await sembrarCreadaEn(foodName, '2026-07-30T20:00:00.000Z', '2026-07-31T02:00:00.000Z');
    await sembrarCreadaEn(foodName, '2026-07-30T04:00:00.000Z', '2026-07-31T09:00:00.000Z');

    const res = await post({ foodName, date: '2026-07-30T22:00:00.000Z', ...dia30 });

    expect(res.body.data.id).toBe(tarde.id);
  });

  /**
   * The mirror of the test above, approached from the other end: there the row
   * being searched for was written first at the START of the window, which pins
   * the lower bound; here it is written at the LAST instant the window holds and
   * the merge arrives from the start, which pins that the search really does
   * reach that far. An upper bound a millisecond short would miss it and stack a
   * second row — the last meal of the night, silently split in two.
   *
   * "The last instant the window holds" is `mergeTo` MINUS ONE, not `mergeTo`:
   * `mergeTo` is where the next day begins and belongs to that day, which the
   * neighbouring tests pin from both sides.
   */
  it('merges into an entry that sits at the last instant the window holds', async () => {
    const foodName = unName();
    const ultimo = new Date(Date.parse(dia30.mergeTo) - 1).toISOString();

    await post({ foodName, date: ultimo, ...dia30 });
    const second = await post({ foodName, date: dia30.mergeFrom, ...dia30 });

    expect(second.body.merged).toBe(true);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(2));
  });

  /**
   * A day is a HALF-OPEN interval: [start of day N, start of day N + 1).
   *
   * The window used to be named by a wall-clock time — 23:59:59.999 local — and
   * a wall-clock name near midnight is not a reliable way to point at an
   * instant. In a zone that falls back at or near local midnight, local 23:xx
   * HAPPENS TWICE and the engine resolves the ambiguous name to the FIRST,
   * pre-transition occurrence, so a real instant inside the SECOND occurrence
   * comes out GREATER than the bound built to contain it. Measured against this
   * route with the bounds the client actually sent:
   *
   *   date=2026-10-29T21:30:00.000Z              (23:30 in Cairo, second pass)
   *   mergeFrom=2026-10-28T21:00:00.000Z
   *   mergeTo=2026-10-29T20:59:59.999Z
   *     -> 400 "date must fall inside the merge window"
   *
   * — for a whole hour, once a year, in 26 IANA zones, and retrying could not
   * help because the clock was the problem. The entry was simply lost.
   *
   * Naming the end of the day as the START OF THE NEXT ONE removes the
   * ambiguity, and then the comparison must be EXCLUSIVE at the top or two
   * consecutive days both claim that one instant.
   *
   * The four tests below pin the contract at the seam: what the window ends at,
   * what it reaches, and that consecutive days tile the timeline exactly.
   */
  it('rejects an entry dated at the very instant its window ends', async () => {
    const res = await post({ foodName: unName(), date: dia30.mergeTo, ...dia30 });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('date must fall inside the merge window');
  });

  it('does not reach an entry that sits at the instant its window ends', async () => {
    const foodName = unName();
    const siguiente = await sembrar(foodName, dia30.mergeTo);

    const res = await post({ foodName, date: laNoche30, ...dia30 });

    expect(res.body.merged).toBe(false);
    expect(res.status).toBe(201);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === siguiente.id)).toMatchObject(raciones(1));
  });

  it('reaches an entry at the last instant before its window ends', async () => {
    const foodName = unName();
    const ultimo = new Date(Date.parse(dia30.mergeTo) - 1).toISOString();
    await sembrar(foodName, ultimo);

    const res = await post({ foodName, date: laNoche30, ...dia30 });

    expect(res.body.merged).toBe(true);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(2));
  });

  /**
   * The seam itself, and the reason the two fixtures share a string. One day's
   * end IS the next day's start, so the instant they have in common must belong
   * to exactly one of them — the later. A closed upper bound gives it to both
   * and the same food is counted on two days; a bound that stopped short of it
   * would give it to neither and the food would fall through the crack between
   * them.
   */
  it('files consecutive days without a gap and without an overlap', async () => {
    const foodName = unName();
    expect(dia30.mergeTo).toBe(dia31.mergeFrom);

    const enLaJuntura = await post({ foodName, date: dia31.mergeFrom, ...dia31 });
    expect(enLaJuntura.status).toBe(201);

    // The day BEFORE must not see it...
    const anterior = await post({ foodName, date: laNoche30, ...dia30 });
    expect(anterior.body.merged).toBe(false);

    // ...and the day it belongs to must.
    const propio = await post({ foodName, date: '2026-07-31T10:00:00.000Z', ...dia31 });
    expect(propio.body.merged).toBe(true);

    const rows = await filas(foodName);
    expect(rows).toHaveLength(2);
  });

  /**
   * The blocker, end to end, with the exact window the fixed client produces for
   * Africa/Cairo on 2026-10-29 — a real 25-hour day — and an instant inside the
   * repeated hour. This is the payload that answered 400.
   */
  it('saves an entry logged inside the hour a fall-back repeats', async () => {
    const diaDeElCairo = { mergeFrom: '2026-10-28T21:00:00.000Z', mergeTo: '2026-10-29T22:00:00.000Z' };

    const res = await post({
      foodName: unName(),
      date: '2026-10-29T21:30:00.000Z',
      ...diaDeElCairo,
    });

    expect(res.status).toBe(201);
  });

  /**
   * A window whose two bounds are equal is not inverted, so the `from > to`
   * check lets it past — but half-open, [t, t) is EMPTY. It holds no instant at
   * all, so no entry can be filed in it, and the route says exactly that instead
   * of merging into a window that does not contain the thing it is merging.
   *
   * This replaces an earlier decision that read the same window as "is there
   * already an entry at exactly this moment?". Half-open, that question has no
   * expression: the interval that contains only `t` is [t, t + 1ms). Nothing is
   * lost by it — `dayBounds()`, the only thing that produces these windows,
   * cannot emit one narrower than 21 hours — and the alternative would be to
   * make this one case closed at the top, which is precisely the mixed
   * inclusivity that cost a day's food in the first place.
   *
   * A window of a single instant, correctly spelled, still works.
   */
  it('refuses to file an entry in a window of zero width, and accepts one of a single instant', async () => {
    const foodName = unName();

    const vacia = await post({ foodName, date: laNoche30, mergeFrom: laNoche30, mergeTo: laNoche30 });
    expect(vacia.status).toBe(400);
    expect(vacia.body.error.details).toContain('date must fall inside the merge window');
    expect(await filas(foodName)).toHaveLength(0);

    const unInstante = {
      mergeFrom: laNoche30,
      mergeTo: new Date(Date.parse(laNoche30) + 1).toISOString(),
    };

    const first = await post({ foodName, date: laNoche30, ...unInstante });
    expect(first.status).toBe(201);

    const second = await post({ foodName, date: laNoche30, ...unInstante });
    expect(second.status).toBe(200);
    expect(second.body.merged).toBe(true);

    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(2));
  });

  /**
   * The COALESCE in the merge exists so a missing macro counts as zero instead
   * of erasing the column. `grams` is the hole in that guarantee.
   *
   * When the food is a FoodItem and the caller sends no calories, the macros
   * are COMPUTED as `caloriesPer100g * (grams / 100)`. `z.number().positive()`
   * has no upper bound — zod does not impose one — so `grams: 1e308` is a
   * perfectly valid request, the product overflows to Infinity, and zod never
   * sees the overflow because it happened after validation. Prisma binds
   * Infinity as SQL NULL, `COALESCE("calories", 0) + NULL` is NULL, and the
   * column the COALESCE was added to protect is ERASED — at HTTP 200, with
   * `grams` left poisoned at 1e308 forever.
   *
   * A number that cannot survive arithmetic is not a serving size. 400.
   */
  it('rejects a serving so large its macros overflow, instead of erasing them', async () => {
    const foodName = unName();
    const alimento = await prisma.foodItem.create({
      data: { name: foodName, caloriesPer100g: 1000, proteinPer100g: 50, carbsPer100g: 100, fatPer100g: 20, isGramBased: true },
    });
    foodItemIds.push(alimento.id);

    const previa = await prisma.nutritionEntry.create({
      data: {
        userId, foodName, foodItemId: alimento.id, mealCategory: 'Desayuno',
        grams: 100, calories: 1000, protein: 50, carbs: 100, fat: 20,
        date: new Date(laNoche30), status: 'COMPLETED',
      },
    });

    const res = await post({
      foodName,
      foodItemId: alimento.id,
      grams: 1e308,
      calories: undefined, protein: undefined, carbs: undefined, fat: undefined,
      date: laNoche30,
      ...dia30,
    });

    expect(res.status).toBe(400);

    const intacta = await prisma.nutritionEntry.findUnique({ where: { id: previa.id } });
    expect(intacta).toMatchObject({ grams: 100, calories: 1000, protein: 50, carbs: 100, fat: 20 });
  });

  /**
   * Bounding the serving closes the caller's half. The food's own per-100g
   * columns are unbounded Floats too, and they come from a different route, so
   * a serving inside the bound can still overflow against a poisoned FoodItem.
   * The COALESCE guarantee cannot depend on what happens to be in that row.
   */
  it('refuses to erase a macro when the food itself overflows a legal serving', async () => {
    const foodName = unName();
    const alimento = await prisma.foodItem.create({
      data: { name: foodName, caloriesPer100g: 1e308, proteinPer100g: 1, carbsPer100g: 1, fatPer100g: 1, isGramBased: true },
    });
    foodItemIds.push(alimento.id);

    const previa = await prisma.nutritionEntry.create({
      data: {
        userId, foodName, foodItemId: alimento.id, mealCategory: 'Desayuno',
        grams: 100, calories: 1000, protein: 50, carbs: 100, fat: 20,
        date: new Date(laNoche30), status: 'COMPLETED',
      },
    });

    const res = await post({
      foodName,
      foodItemId: alimento.id,
      grams: 100000,
      calories: undefined, protein: undefined, carbs: undefined, fat: undefined,
      date: laNoche30,
      ...dia30,
    });

    expect(res.status).toBe(400);

    const intacta = await prisma.nutritionEntry.findUnique({ where: { id: previa.id } });
    expect(intacta).toMatchObject({ grams: 100, calories: 1000 });
  });

  /** A real serving, however generous, still goes through. The bound is a ceiling, not a policy. */
  it('still accepts a serving at the top of the sane range', async () => {
    const res = await post({ foodName: unName(), grams: 100000, date: laNoche30, ...dia30 });
    expect(res.status).toBe(201);
  });

  it('never merges into another meal', async () => {
    const foodName = unName();
    await post({ foodName, date: laNoche30, mealCategory: 'Desayuno', ...dia30 });
    const second = await post({ foodName, date: laNoche30, mealCategory: 'Cena', ...dia30 });

    expect(second.body.merged).toBe(false);
    expect(await filas(foodName)).toHaveLength(2);
  });

  it('never merges into another user\'s entry', async () => {
    const foodName = unName();
    await post({ foodName, date: laNoche30, ...dia30 }, otherToken);
    const mine = await post({ foodName, date: laNoche30, ...dia30 });

    expect(mine.body.merged).toBe(false);
    expect(await filas(foodName)).toHaveLength(1);
    expect(
      await prisma.nutritionEntry.count({ where: { userId: otherUserId, foodName } })
    ).toBe(1);
  });

  /**
   * No window given is the legacy path, kept so a client running an older
   * bundle mid-deploy keeps working. It is the one behaviour here that IS the
   * server's timezone, so the two instants are built in local time: 08:00 and
   * 20:00 of one local day, whichever timezone the process runs in.
   */
  it('still merges same-day entries when no window is given', async () => {
    const foodName = unName();
    const manana = new Date(2026, 6, 30, 8, 0, 0).toISOString();
    const noche = new Date(2026, 6, 30, 20, 0, 0).toISOString();

    await post({ foodName, date: manana });
    const second = await post({ foodName, date: noche });

    expect(second.body.merged).toBe(true);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject(raciones(2));
  });

  /**
   * The window is CALLER-SUPPLIED, so it is untrusted input, and an unbounded
   * one lets the caller merge across anything at all. A window of a century
   * merged today's food into a row from a previous year — which then vanishes
   * from today's diary. That is the exact defect this window exists to remove,
   * re-entering through the input that replaced it.
   */
  it('rejects a window wider than a day', async () => {
    const res = await post({
      foodName: unName(),
      date: laNoche30,
      mergeFrom: '2000-01-01T00:00:00.000Z',
      mergeTo: '2099-01-01T00:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('28 hours');
  });

  it('does not let an unbounded window reach an entry from another year', async () => {
    const foodName = unName();
    const vieja = await sembrar(foodName, '2025-01-05T12:00:00.000Z');

    const res = await post({
      foodName,
      date: laNoche30,
      mergeFrom: '2000-01-01T00:00:00.000Z',
      mergeTo: '2099-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(400);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(vieja.id);
    expect(rows[0]).toMatchObject(raciones(1));
  });

  /**
   * 28 hours, not 24: a local day is not always 24 hours long, and the limit
   * must never reject a legitimate one. Measured rather than guessed — sweeping
   * every IANA zone at one-minute resolution around every offset transition
   * from 2015 to 2035, the widest day `dayBounds()` can produce is 27 hours and
   * the narrowest 21, both Antarctica/Casey, which shifts three hours at once.
   *
   * It was 48, which is not a day but two: `[day N 00:00, day N+1 24:00)` fits
   * inside it, and an entry dated on the 30th merged into a row from the 29th.
   *
   * This window is Africa/Cairo's 29th of October 2026 — the next 25-hour day
   * anywhere, and the one that broke this route. It is the literal output of the
   * client's own `dayBounds()` in that zone, so the slack is pinned by a window
   * a real client really sends.
   *
   * It previously claimed to be "Buenos Aires falling back", which it was not:
   * Buenos Aires keeps ONE UTC offset for the whole of 2026 and has not observed
   * DST since 2009, so that window was hand-built and no client could produce
   * it. Since the suite also RUNS in Buenos Aires, the claim was doubly
   * misleading — it suggested the ambient timezone exercised a transition it
   * cannot exercise.
   */
  it('accepts a 25-hour window, the width of a day that falls back', async () => {
    const res = await post({
      foodName: unName(),
      date: '2026-10-29T12:00:00.000Z',
      mergeFrom: '2026-10-28T21:00:00.000Z',
      mergeTo: '2026-10-29T22:00:00.000Z',
    });
    expect(res.status).toBe(201);
  });

  /**
   * Two whole local days fit inside 48 hours minus a millisecond, which is how
   * the old limit let an entry dated on the 30th be absorbed by a row from the
   * 29th — this bug again, through the input that replaced it.
   */
  it('rejects a window that spans two whole days', async () => {
    const foodName = unName();
    const dia29 = await sembrar(foodName, '2026-07-29T15:00:00.000Z');

    const res = await post({
      foodName,
      date: '2026-07-30T15:00:00.000Z',
      mergeFrom: '2026-07-29T03:00:00.000Z',
      mergeTo: '2026-07-31T02:59:59.999Z',
    });

    expect(res.status).toBe(400);
    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(dia29.id);
    expect(rows[0]).toMatchObject(raciones(1));
  });

  it('accepts a window exactly 28 hours wide and rejects one a millisecond wider', async () => {
    const desde = '2026-07-30T03:00:00.000Z';
    const limite = 28 * 60 * 60 * 1000;
    const justo = new Date(Date.parse(desde) + limite).toISOString();
    const pasado = new Date(Date.parse(desde) + limite + 1).toISOString();

    const borde = await post({ foodName: unName(), date: desde, mergeFrom: desde, mergeTo: justo });
    expect(borde.status).toBe(201);

    const excedido = await post({ foodName: unName(), date: desde, mergeFrom: desde, mergeTo: pasado });
    expect(excedido.status).toBe(400);
  });

  /**
   * `new Date(raw)` accepts far more than ISO, and what it accepts it resolves
   * against the SERVER's clock: "July 31 2026" is 03:00Z in Buenos Aires, 00:00Z
   * in UTC and the previous day at 15:00Z in Tokyo. A bound like that re-derives
   * the window from the server's timezone — precisely what this endpoint stopped
   * doing. A bound with no zone designator is the same trap in ISO clothing.
   *
   * The assertion is run under three server timezones because "rejected" has to
   * mean rejected everywhere; a bound whose meaning depends on where the process
   * runs must never be accepted, not even in the timezone where it looks right.
   */
  const sinZona = ['July 31 2026', '2026-07-31', '2026-07-31T02:00:00', '07/31/2026', '1785456000000'];

  it('rejects a bound that is not an ISO instant, under every server timezone', async () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['UTC', 'America/Buenos_Aires', 'Asia/Tokyo']) {
        process.env.TZ = tz;
        for (const raw of sinZona) {
          const res = await post({ foodName: unName(), date: laNoche30, mergeFrom: raw, mergeTo: dia30.mergeTo });
          expect(res.status, `TZ=${tz} mergeFrom=${raw}`).toBe(400);
          expect(res.body.error.details, `TZ=${tz} mergeFrom=${raw}`).toContain('mergeFrom');
        }
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  /**
   * `date` is a bound too — it decides which day the entry is filed under — and
   * it was the one bound nobody parsed. `z.string()` accepts any characters at
   * all, and `new Date("garbage")` is an Invalid Date whose every comparison is
   * FALSE: `entryDate < from` and `entryDate > to` are both false, so the
   * containment guard hands an unparseable date straight through and the entry
   * merges into whatever row the window happens to match.
   *
   * The guard reads as if it closes this. It does not, and that is why it is
   * pinned by an entry that must survive untouched, not just by a status code.
   */
  const fechasInvalidas = ['garbage', '', '1e999', '${jndi:ldap://x}', 'July 31 2026', '2026-07-31', '2026-07-31T02:00:00'];

  it('rejects a date that is not an ISO instant instead of merging on it', async () => {
    for (const raw of fechasInvalidas) {
      const foodName = unName();
      const sembrada = await sembrar(foodName, laNoche30);

      const res = await post({ foodName, date: raw, ...dia30 });

      const cual = `date=${JSON.stringify(raw)}`;
      expect(res.status, cual).toBe(400);
      expect(res.body.error.details, cual).toContain('date');

      const rows = await filas(foodName);
      expect(rows, cual).toHaveLength(1);
      expect(rows[0].id, cual).toBe(sembrada.id);
      expect(rows[0], cual).toMatchObject(raciones(1));
    }
  });

  /**
   * The same string with no window at all. That path never reaches the
   * containment guard: it builds the server's own calendar day out of the
   * Invalid Date, and every instant it derives is invalid too. Same input, same
   * answer, whichever path it takes.
   */
  it('rejects an unparseable date on the windowless path too', async () => {
    const res = await post({ foodName: unName(), date: 'garbage' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('date');
  });

  /** The bound the real client sends is toISOString(), and it must keep working. */
  it('accepts the ISO instant a real client sends', async () => {
    const res = await post({ foodName: unName(), date: laNoche30, ...dia30 });
    expect(res.status).toBe(201);
  });

  /** A UTC offset is still an unambiguous instant, so it is still a valid bound. */
  it('accepts a bound written with a UTC offset instead of Z', async () => {
    const res = await post({
      foodName: unName(),
      date: '2026-07-30T12:00:00.000Z',
      mergeFrom: '2026-07-30T00:00:00.000-03:00',
      mergeTo: '2026-07-31T00:00:00.000-03:00',
    });
    expect(res.status).toBe(201);
  });

  /**
   * ISO 8601 is WIDER than `Date.prototype.toISOString()`, and this parser was
   * narrower than ISO. Requiring an explicit zone designator is the load-bearing
   * part of the check and stays; requiring the browser's exact spelling of
   * everything else was never part of it, and it narrowed an endpoint that had
   * already shipped — the GET range filter shares this parser, and all three
   * forms below worked against it before the shape check existed.
   *
   * Each string names the SAME instant as `laNoche30`, so "accepted" is asserted
   * as "stored at the instant it names", not merely as a 201. A parser that let
   * the string through and then resolved it somewhere else would be the
   * server-timezone bug wearing the fix's clothes.
   */
  const dialectos: [string, string][] = [
    // Six fractional digits — what Python's `datetime.isoformat()`, Go's
    // `RFC3339Nano`, Java's `Instant.toString()` and a Postgres `::text` cast
    // all emit. Sub-millisecond precision the column cannot hold anyway, so it
    // is truncated, not refused.
    ['six fractional digits', '2026-07-31T02:00:00.000000Z'],
    // RFC 3339 §5.6: "NOTE: ISO 8601 defines date and time separated by 'T'.
    // Applications using this syntax may choose ... to use a lower case 't'."
    // The 'Z' is the same.
    ['a lower case t and z', '2026-07-31t02:00:00.000z'],
    // The ISO basic-format offset. 05:00 at +03:00 is 02:00Z, colon or no colon.
    ['a basic-format offset', '2026-07-31T05:00:00.000+0300'],
  ];

  it('accepts the ISO instants other languages emit, and files them where they say', async () => {
    for (const [dialecto, raw] of dialectos) {
      const foodName = unName();

      const res = await post({ foodName, date: raw, ...dia30 });

      expect(res.status, dialecto).toBe(201);
      expect(new Date(res.body.data.date).toISOString(), dialecto).toBe(laNoche30);
    }
  });

  /**
   * The same three dialects as the WINDOW, which is the half that decides what
   * the entry merges into. A window that parsed to a different instant than it
   * spells would search the wrong day, so it is pinned by an actual merge into a
   * row seeded at a fixed instant — not by a status code.
   */
  const ventanasEquivalentes: [string, { mergeFrom: string; mergeTo: string }][] = [
    ['six fractional digits', { mergeFrom: '2026-07-30T03:00:00.000000Z', mergeTo: '2026-07-31T03:00:00.000000Z' }],
    ['a lower case t and z', { mergeFrom: '2026-07-30t03:00:00.000z', mergeTo: '2026-07-31t03:00:00.000z' }],
    ['a basic-format offset', { mergeFrom: '2026-07-30T00:00:00.000-0300', mergeTo: '2026-07-31T00:00:00.000-0300' }],
  ];

  it('reads a window written in any of those dialects as the same window', async () => {
    for (const [dialecto, ventana] of ventanasEquivalentes) {
      const foodName = unName();
      const sembrada = await sembrar(foodName, laNoche30);

      const res = await post({ foodName, date: laNoche30, ...ventana });

      expect(res.status, dialecto).toBe(200);
      expect(res.body.merged, dialecto).toBe(true);
      expect(res.body.data.id, dialecto).toBe(sembrada.id);

      const rows = await filas(foodName);
      expect(rows, dialecto).toHaveLength(1);
      expect(rows[0], dialecto).toMatchObject(raciones(2));
    }
  });

  /**
   * `2026-07-31T24:00:00Z` is 2026-08-01T00:00:00Z to `new Date`. The shape
   * matches, and the calendar check passes because it validates the day the
   * STRING spells — the 31st, which exists — while the instant lands on the 1st
   * of the NEXT MONTH. That is exactly the "a bound must not mean a different
   * instant than it says" class the calendar check was added to stop, arriving
   * through the clock instead of through the calendar, and slipping past the
   * width cap untouched because a shifted window is not a wider one.
   */
  it('rejects an hour of 24, which lands on a day the string does not name', async () => {
    const res = await post({ foodName: unName(), date: '2026-07-31T24:00:00.000Z' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('date');
  });

  it('does not let an hour of 24 shift a window onto another day', async () => {
    const foodName = unName();

    const res = await post({
      foodName,
      date: laNoche30,
      mergeFrom: '2026-07-30T24:00:00.000Z',
      mergeTo: dia30.mergeTo,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('mergeFrom');
    expect(await filas(foodName)).toHaveLength(0);
  });

  /**
   * The same hole, one field down. `new Date` already refuses a minute or a
   * second of 60 — measured — so this is a REGRESSION GUARD rather than a defect
   * being closed: widening the shape means normalising the string before parsing
   * it, and the obvious normalisation, rebuilding through `Date.UTC(y, m, d, h,
   * mi, s)`, would roll 02:60 into 03:00 and hand back a bound the caller never
   * wrote. The guard is here so that reappearing costs a red test.
   */
  it('rejects a minute or a second of 60 rather than rolling it forward', async () => {
    for (const raw of ['2026-07-31T02:60:00.000Z', '2026-07-31T02:00:60.000Z']) {
      const res = await post({ foodName: unName(), date: raw });

      expect(res.status, raw).toBe(400);
      expect(res.body.error.details, raw).toContain('date');
    }
  });

  /**
   * The shape being right does not make the day real. `new Date` ROLLS a
   * nonexistent day over instead of rejecting it: "2026-02-31T00:00:00Z" comes
   * back as 2026-03-03, so the window the server searches is three days away
   * from the one the caller sent — and it moved silently, because its WIDTH is
   * untouched and the 48-hour cap has nothing to complain about.
   *
   * A bound that means a different instant than it says is the same class of
   * defect as a bound with no timezone. Rejected, not guessed at.
   */
  it('rejects a day that does not exist instead of rolling it into the next month', async () => {
    const res = await post({
      foodName: unName(),
      date: '2026-03-03T06:00:00.000Z',
      mergeFrom: '2026-02-31T00:00:00.000Z',
      mergeTo: '2026-03-04T00:00:00.000Z',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('mergeFrom');
  });

  /** The same rollover through `date`, which would file the entry on a day the caller never named. */
  it('rejects an entry date that does not exist on the calendar', async () => {
    const res = await post({ foodName: unName(), date: '2026-02-31T00:00:00.000Z' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('date');
  });

  /**
   * February the 29th exists in 2024 and does not in 2026. The check has to
   * know the difference, or it trades a silent shift for a rejected real day.
   */
  it('tells a leap day apart from one that never happened', async () => {
    const real = await post({
      foodName: unName(),
      date: '2024-02-29T12:00:00.000Z',
      mergeFrom: '2024-02-29T00:00:00.000Z',
      mergeTo: '2024-03-01T00:00:00.000Z',
    });
    expect(real.status).toBe(201);

    const inventado = await post({ foodName: unName(), date: '2026-02-29T12:00:00.000Z' });
    expect(inventado.status).toBe(400);
  });

  it('rejects a malformed window bound instead of ignoring it', async () => {
    const res = await post({ foodName: unName(), date: laNoche30, mergeFrom: 'ayer', mergeTo: dia30.mergeTo });
    expect(res.status).toBe(400);
  });

  /**
   * An inverted window is empty, so the containment check below would reject it
   * too — but for the wrong reason. A client debugging its own bounds needs to
   * be told which end is wrong, so the reason is asserted, not just the status.
   */
  it('rejects a window that ends before it starts, and says so', async () => {
    const res = await post({
      foodName: unName(),
      date: laNoche30,
      mergeFrom: dia30.mergeTo,
      mergeTo: dia30.mergeFrom,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('mergeFrom must not be after mergeTo');
  });

  it('rejects half a window', async () => {
    const res = await post({ foodName: unName(), date: laNoche30, mergeFrom: dia30.mergeFrom });
    expect(res.status).toBe(400);
  });

  /**
   * An entry stored on one day but merged against another's window would search
   * a day it does not belong to, which is the defect this window exists to
   * close. Incoherent in, 400 out.
   */
  it('rejects an entry whose date falls outside its own window', async () => {
    const res = await post({ foodName: unName(), date: laMadrugada31, ...dia30 });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('date must fall inside the merge window');
    // The caller DID send a date, so it must not be told one was invented.
    expect(res.body.error.details).not.toContain('defaulted');
  });

  /**
   * The containment check has two halves and the test above only exercises the
   * upper one. An entry dated BEFORE its own window is just as incoherent, and
   * would search a day it does not belong to in the other direction.
   */
  it('rejects an entry whose date falls before its own window', async () => {
    const res = await post({ foodName: unName(), date: '2026-07-30T02:00:00.000Z', ...dia30 });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('date must fall inside the merge window');
  });

  /**
   * `date` is optional and defaults to now. A client logging food for any day
   * other than today, and leaving `date` off, was told "date must fall inside
   * the merge window" about a date it never sent — unactionable, and it reads
   * like the window is wrong when the missing date is. Say which one it is.
   */
  it('says the date was defaulted when the caller omitted it', async () => {
    const res = await post({
      foodName: unName(),
      mergeFrom: '2020-01-01T00:00:00.000Z',
      mergeTo: '2020-01-02T00:00:00.000Z',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('defaulted');
  });
});
