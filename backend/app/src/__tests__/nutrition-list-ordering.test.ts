import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * GET /api/nutrition orders its list by `date DESC`, then breaks a tie on
 * `date` by `createdAt ASC, id ASC`.
 *
 * `date` alone is not a total order on this route: the diary sends
 * `selectedDate.toISOString()` from a `useState(new Date())` captured ONCE at
 * mount, so every entry a user logs in one sitting on one day carries the
 * IDENTICAL millisecond. `ORDER BY` on a constant key is no order at all —
 * ties are whatever the planner hands back — and it is not even STABLE
 * across a write: Postgres never rewrites a row in place, an UPDATE appends a
 * new tuple version at the end of the heap, so editing one of the tied rows
 * (exactly what the "edit entry" sheet does) can silently move it to the end
 * of the list the user is looking at.
 *
 * The tie-break DIRECTION is a PRODUCT DECISION, not a copy of the merge
 * lookup's `desc` a few lines above the line under test. That `findFirst`
 * answers "which row absorbs this merge?", where the newest match should win
 * — a different question from "in what order does a human read their own day
 * back?". What a user expects within one day is the order they LOGGED it in
 * — breakfast, then lunch, then dinner, each appended below the last — which
 * is `createdAt ASC`. `id ASC` only breaks the residual tie among rows that
 * even share a `createdAt`, which a single `createMany` inside one
 * transaction genuinely produces, since every row in it gets the same
 * transaction-start `now()`.
 *
 * Every assertion below is POSITIONAL — the exact expected sequence of ids —
 * on purpose. The previous version of this file asserted `idsAntes.sort()`
 * against `[a,b,c].sort()` (a SET comparison, not an order one) and then
 * `idsDespues` against `idsAntes` (the result compared against itself, which
 * pins determinism, not which order is correct). MEASURED: with the sort
 * column deleted from the endpoint entirely (`orderBy: { id: 'asc' }`), both
 * assertions still passed, and so did the rest of the 752-test suite.
 */
describe('GET /api/nutrition list ordering', () => {
  let userId: string;
  let authToken: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `nutri.order.${stamp}@example.com`, password: 'password123', name: 'Order Tester' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterAll(async () => {
    await prisma.nutritionEntry.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  beforeEach(async () => {
    await prisma.nutritionEntry.deleteMany({ where: { userId } });
  });

  const auth = (req: request.Test) => req.set('Cookie', [`auth_token=${authToken}`]);

  const RACION = { grams: 100, calories: 100, protein: 5, carbs: 10, fat: 2 };

  // Explicit `id` and `createdAt`: the only way to force the exact ties the
  // tie-break exists for. Sequential `create()` calls each get their OWN
  // `now()` a few milliseconds apart — measured, `.170Z`, `.178Z`, `.181Z` —
  // so left to default they never actually tie on `createdAt`, and `id`
  // would never be exercised even in principle.
  const sembrar = (id: string, foodName: string, date: Date, createdAt: Date = new Date()) =>
    prisma.nutritionEntry.create({
      data: { id, userId, foodName, mealCategory: 'Desayuno', ...RACION, date, createdAt, status: 'COMPLETED' },
    });

  const idsDe = (res: request.Response) => res.body.data.map((e: { id: string }) => e.id);

  it('keeps the same order across an UPDATE of one of the tied rows', async () => {
    const unDia = new Date('2026-07-30T20:00:00.000Z');

    // The ordinary path, not a contrived tie: three real sequential creates,
    // each getting its own slightly-later `createdAt` — the same shape the
    // diary produces logging breakfast, then lunch, then dinner.
    const a = await prisma.nutritionEntry.create({
      data: { userId, foodName: `orden-a-${stamp}`, mealCategory: 'Desayuno', ...RACION, date: unDia, status: 'COMPLETED' },
    });
    const b = await prisma.nutritionEntry.create({
      data: { userId, foodName: `orden-b-${stamp}`, mealCategory: 'Desayuno', ...RACION, date: unDia, status: 'COMPLETED' },
    });
    const c = await prisma.nutritionEntry.create({
      data: { userId, foodName: `orden-c-${stamp}`, mealCategory: 'Desayuno', ...RACION, date: unDia, status: 'COMPLETED' },
    });

    const antes = await auth(request(app).get('/api/nutrition'));
    expect(antes.status).toBe(200);
    // Positional: the order they were LOGGED in, oldest `createdAt` first.
    expect(idsDe(antes)).toEqual([a.id, b.id, c.id]);

    // The exact edit the "edit entry" sheet performs: PATCH one field of one
    // of the tied rows. `grams` is not part of the sort key, and neither is
    // wherever Postgres relocates the row's physical tuple on the update —
    // the list must read back in the same creation order regardless.
    const patch = await auth(request(app).patch(`/api/nutrition/${b.id}`).send({ grams: 150 }));
    expect(patch.status).toBe(200);

    const despues = await auth(request(app).get('/api/nutrition'));
    expect(idsDe(despues)).toEqual([a.id, b.id, c.id]);
  });

  /**
   * MUTANT KILL: reverting the tie-break's direction (`createdAt: 'desc'`)
   * or dropping `id` from it (`[{date:'desc'},{id:'asc'}]`, which falls back
   * to `id` alone whenever `createdAt` is not itself tied) both have to die
   * here. `id` is set to CONTRADICT `createdAt`'s real order, and the row
   * that must lose is inserted FIRST — the same technique
   * nutrition-merge-window.test.ts uses to make heap order the wrong answer
   * — so plain `{date:'desc'}` dies too. `foodName` contradicts as well, so
   * a `{foodName:'asc'}` mutant cannot pass here by accident either.
   */
  it('orders a same-day tie by which entry was logged first, not by its id or its name', async () => {
    const unDia = new Date('2026-07-30T20:00:00.000Z');
    const temprano = new Date('2026-07-30T08:00:00.000Z'); // breakfast: logged first
    const tarde = new Date('2026-07-30T20:00:00.000Z'); // dinner: logged later

    // Inserted OUT of the order they must be read back in.
    const cena = await sembrar(`${stamp}-aa-late`, `aaaa-${stamp}`, unDia, tarde);
    const desayuno = await sembrar(`${stamp}-zz-early`, `zzzz-${stamp}`, unDia, temprano);

    const res = await auth(request(app).get('/api/nutrition'));
    expect(res.status).toBe(200);
    expect(idsDe(res)).toEqual([desayuno.id, cena.id]);
  });

  /**
   * MUTANT KILL: three rows tied on BOTH `date` AND `createdAt` — the shape
   * a single `createMany` inside one transaction actually produces, since
   * every row in it shares the transaction's one `now()`. With both keys
   * tied, `id` is the ONLY thing left to break it, so dropping it
   * (`[{date:'desc'},{createdAt:'asc'}]`) falls back to whatever order
   * Postgres hands back — made to be the WRONG order here by inserting out
   * of id sequence. `foodName` is set to contradict the expected order too.
   */
  it('breaks a tie on date and creation time by id, ascending', async () => {
    const unDia = new Date('2026-07-30T12:00:00.000Z');
    const unMomento = new Date('2026-07-30T20:00:00.000Z');

    // Created out of id order, and named out of id order too.
    const tres = await sembrar(`${stamp}-tie-3`, `xxx-3-${stamp}`, unDia, unMomento);
    const uno = await sembrar(`${stamp}-tie-1`, `zzz-1-${stamp}`, unDia, unMomento);
    const dos = await sembrar(`${stamp}-tie-2`, `yyy-2-${stamp}`, unDia, unMomento);

    const res = await auth(request(app).get('/api/nutrition'));
    expect(res.status).toBe(200);
    expect(idsDe(res)).toEqual([uno.id, dos.id, tres.id]);
  });

  /**
   * MUTANT KILL: dropping `date` entirely (`{id:'asc'}`) has to die even
   * though the ordering above is all about tie-breaks. The newer day's
   * entry is given the lexicographically LARGER id, so ordering by `id`
   * alone gives the OLDER day first — the opposite of what a diary must
   * show.
   */
  it('sorts a newer day before an older one regardless of id', async () => {
    const diaNuevo = new Date('2026-07-30T20:00:00.000Z');
    const diaViejo = new Date('2026-07-29T20:00:00.000Z');

    const viejo = await sembrar(`${stamp}-aa-old`, `dia-viejo-${stamp}`, diaViejo);
    const nuevo = await sembrar(`${stamp}-zz-new`, `dia-nuevo-${stamp}`, diaNuevo);

    const res = await auth(request(app).get('/api/nutrition'));
    expect(res.status).toBe(200);
    expect(idsDe(res)).toEqual([nuevo.id, viejo.id]);
  });

  /**
   * The defect this file exists to close: a row repeated across two pages,
   * and another dropped between them, because `ORDER BY date DESC` alone is
   * not a total order and the plan is free to reshuffle ties between two
   * separate queries. MEASURED: against the old `{date:'desc'}` ordering, 60
   * rows read back in pages of 10 produced 1 duplicate and 1 row never
   * returned; against the fix, 0 and 0.
   *
   * All 60 rows are created in ONE `createMany`, inside one transaction, so
   * they share both `date` and the transaction's single `now()` for
   * `createdAt` — every tie the fix's `id` key exists to break, at once.
   * That makes the total order depend entirely on `id`, which is unique, so
   * the pages must partition the 60 rows exactly: no row seen twice, none
   * missed.
   */
  it('reads every row exactly once across pages when many rows tie on date', async () => {
    const N = 60;
    const PAGE = 10;
    const unDia = new Date('2026-07-28T12:00:00.000Z');
    const ids = Array.from({ length: N }, (_, i) => `${stamp}-page-${i}`);

    await prisma.nutritionEntry.createMany({
      data: ids.map((id) => ({
        id,
        userId,
        foodName: `pagina-${stamp}`,
        mealCategory: 'Desayuno',
        ...RACION,
        date: unDia,
        status: 'COMPLETED',
      })),
    });

    const vistos: string[] = [];
    for (let offset = 0; offset < N; offset += PAGE) {
      const res = await auth(request(app).get(`/api/nutrition?offset=${offset}&limit=${PAGE}`));
      expect(res.status).toBe(200);
      vistos.push(...idsDe(res));
    }

    expect(vistos).toHaveLength(N);
    expect(new Set(vistos).size).toBe(N);
    expect(new Set(vistos)).toEqual(new Set(ids));
  });
});
