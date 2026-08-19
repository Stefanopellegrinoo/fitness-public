import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * The numbers /api/nutrition stores, and the ceilings that keep them storable.
 *
 * Every value on this route ends up in a `double precision` column that a LATER
 * request will ADD TO. That is the property the bounds exist to protect, and it
 * is why "zod accepted it" is not the same as "it is safe": a value can pass
 * validation, store at 201, and only detonate on the next merge.
 *
 * Two holes are pinned here.
 *
 * `grams` is bounded and the four macros are not, so a caller can STATE
 * `calories: 1e308`. Nothing overflows on the way in. The merge adds in the
 * database, `1e308 + 1e308` is out of range for a float8, and Postgres RAISES
 * (SQLSTATE 22003, `value out of range: overflow`) instead of saturating — so
 * every subsequent merge into that row answers 500, forever, because the
 * poisoned value is what it keeps adding to. One request permanently costs the
 * user the ability to log that food.
 *
 * And PATCH recomputes the same product POST does — `caloriesPer100g *
 * (grams / 100)` — from the same unbounded FoodItem columns, with none of the
 * finiteness guard POST has. An Infinity there is bound by Prisma as SQL NULL,
 * so the column is not poisoned but ERASED, at HTTP 200.
 */
describe('/api/nutrition numeric bounds', () => {
  let userId: string;
  let authToken: string;
  const stamp = Date.now();
  let seq = 0;
  // FoodItems outlive the per-test entry cleanup, so they are tracked and
  // removed by hand at the end. The database is disposable, not a dumping ground.
  const foodItemIds: string[] = [];

  // One Buenos Aires day, and an instant inside it. Written in UTC and stated
  // explicitly, so these assertions hold under any server timezone.
  const dia30 = { mergeFrom: '2026-07-30T03:00:00.000Z', mergeTo: '2026-07-31T03:00:00.000Z' };
  const laNoche30 = '2026-07-31T02:00:00.000Z';

  // The ceilings the route is expected to enforce. Restated here rather than
  // imported: a test that reads its expectation out of the implementation
  // cannot tell the two apart, and would follow the route wherever it moved.
  const MAX_GRAMS = 100000;
  const MAX_KCAL = 1000000;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `nutri.bounds.${stamp}@example.com`, password: 'password123', name: 'Bounds Tester' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterAll(async () => {
    await prisma.nutritionEntry.deleteMany({ where: { userId } });
    await prisma.foodItem.deleteMany({ where: { id: { in: foodItemIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  beforeEach(async () => {
    await prisma.nutritionEntry.deleteMany({ where: { userId } });
  });

  // The merge also matches by name, so two tests sharing one would merge into
  // each other's rows.
  const unName = () => `bounds ${stamp} ${seq++}`;

  const post = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/nutrition')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ foodName: 'sin nombre', mealCategory: 'Desayuno', grams: 100, ...body });

  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/nutrition/${id}`).set('Cookie', [`auth_token=${authToken}`]).send(body);

  const filas = (foodName: string) => prisma.nutritionEntry.findMany({ where: { userId, foodName } });

  /** A FoodItem with the per-100g figures a test needs, tracked for cleanup. */
  const alimento = async (name: string, caloriesPer100g: number) => {
    const item = await prisma.foodItem.create({
      data: { name, caloriesPer100g, proteinPer100g: 1, carbsPer100g: 1, fatPer100g: 1, isGramBased: true },
    });
    foodItemIds.push(item.id);
    return item;
  };

  /** A row seeded directly, so a PATCH has something to aim at. */
  const sembrar = (foodName: string, foodItemId: string | null, grams = 100) =>
    prisma.nutritionEntry.create({
      data: {
        userId, foodName, foodItemId, mealCategory: 'Desayuno', grams,
        calories: 1000, protein: 50, carbs: 100, fat: 20,
        date: new Date(laNoche30), status: 'COMPLETED',
      },
    });

  /**
   * PATCH recomputes the macros from the FoodItem exactly as POST does, and
   * POST's finiteness guard is on POST only. The comment above the PATCH schema
   * says the ceiling is there "because PATCH recomputes the same macros from the
   * same product" — which is true, and which is precisely why the ceiling on its
   * own is not enough: `caloriesPer100g` is an unbounded Float that arrives from
   * a different route, so a legal serving of a poisoned food still overflows.
   *
   * MEASURED before the fix: HTTP 200 with `calories: null` — Prisma binds
   * Infinity as SQL NULL, so the column is not merely wrong, it is GONE, and the
   * row's own history of it with it.
   */
  it('rejects a PATCH whose recomputed macros overflow, instead of erasing them', async () => {
    const foodName = unName();
    const comida = await alimento(foodName, 1e308);
    const fila = await sembrar(foodName, comida.id);

    const res = await patch(fila.id, { grams: MAX_GRAMS });

    expect(res.status).toBe(400);

    const intacta = await prisma.nutritionEntry.findUnique({ where: { id: fila.id } });
    expect(intacta).toMatchObject({ grams: 100, calories: 1000, protein: 50, carbs: 100, fat: 20 });
  });

  /**
   * The guard must be a guard, not a blanket refusal. A PATCH that changes the
   * serving of an ordinary food still recomputes the macros and still stores
   * them — otherwise the fix above would have quietly broken every edit on the
   * route, and no test on this route would have noticed, because there were
   * none.
   */
  it('still recomputes a PATCH whose macros stay finite', async () => {
    const foodName = unName();
    const comida = await alimento(foodName, 250);
    const fila = await sembrar(foodName, comida.id);

    const res = await patch(fila.id, { grams: 200 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ grams: 200, calories: 500, protein: 2, carbs: 2, fat: 2 });
  });

  /**
   * The stated macros, not the computed ones. `z.number().nonnegative()` has no
   * ceiling, so `1e308` is a valid request that stores at 201 — and then the
   * NEXT merge into that row runs `COALESCE("calories", 0) + 1e308` in Postgres,
   * which is `value out of range: overflow` (SQLSTATE 22003), not Infinity and
   * not a saturated maximum. The route answers 500 and goes on answering 500 for
   * that row forever, because the poisoned value is the left-hand side of every
   * later sum.
   *
   * Both halves are asserted: the request is refused, and nothing is stored for
   * a later request to trip over.
   */
  it('refuses a stated energy that no later merge could add to', async () => {
    const foodName = unName();

    const res = await post({ foodName, calories: 1e308, date: laNoche30, ...dia30 });

    expect(res.status).toBe(400);
    expect(await filas(foodName)).toHaveLength(0);
  });

  it('refuses a stated macro weight that no later merge could add to', async () => {
    for (const macro of ['protein', 'carbs', 'fat'] as const) {
      const foodName = unName();

      const res = await post({ foodName, [macro]: 1e308, date: laNoche30, ...dia30 });

      expect(res.status, macro).toBe(400);
      expect(await filas(foodName), macro).toHaveLength(0);
    }
  });

  /**
   * The same hole on the update path. PATCH takes the four macros verbatim too,
   * and a row poisoned through PATCH is just as un-mergeable as one poisoned
   * through POST.
   */
  it('refuses an unstorable macro on the update path too', async () => {
    const foodName = unName();
    const fila = await sembrar(foodName, null);

    for (const macro of ['calories', 'protein', 'carbs', 'fat'] as const) {
      const res = await patch(fila.id, { [macro]: 1e308 });
      expect(res.status, macro).toBe(400);
    }

    const intacta = await prisma.nutritionEntry.findUnique({ where: { id: fila.id } });
    expect(intacta).toMatchObject({ calories: 1000, protein: 50, carbs: 100, fat: 20 });
  });

  /**
   * The ceiling is derived from what a real food can be, the way MAX_GRAMS is:
   * the densest thing a food can be made of is pure fat at 9 kcal per gram, so
   * the most energy 100 kg of it can hold is 900000 kcal. A million clears that,
   * and it costs no legitimate caller anything. A macro is a WEIGHT, and a macro
   * cannot weigh more than the food it is part of, so its ceiling is MAX_GRAMS.
   *
   * Asserted at the edge from both sides, so the bound cannot drift without a
   * test saying so.
   */
  it('accepts the most energy a real serving can hold, and refuses a calorie more', async () => {
    const justo = await post({ foodName: unName(), calories: MAX_KCAL, date: laNoche30, ...dia30 });
    expect(justo.status).toBe(201);

    const pasado = await post({ foodName: unName(), calories: MAX_KCAL + 1, date: laNoche30, ...dia30 });
    expect(pasado.status).toBe(400);
  });

  it('accepts a macro as heavy as the food itself, and refuses a gram more', async () => {
    const justo = await post({ foodName: unName(), protein: MAX_GRAMS, date: laNoche30, ...dia30 });
    expect(justo.status).toBe(201);

    const pasado = await post({ foodName: unName(), protein: MAX_GRAMS + 1, date: laNoche30, ...dia30 });
    expect(pasado.status).toBe(400);
  });

  /**
   * THE DECISION, pinned so it cannot be "tidied up" later.
   *
   * The ceiling bounds ONE REQUEST, never the stored total. A row that has
   * absorbed many merges may legitimately hold more than any single serving
   * could, and refusing THAT would be the same defect from the other side: the
   * row would become un-mergeable and the user could never log that food into it
   * again — a 400 forever instead of a 500 forever.
   *
   * What the input ceiling has to buy is that no REACHABLE sum can overflow, and
   * it does: at a million per request it would take 1e302 requests to approach
   * Number.MAX_VALUE. So the sum is deliberately left unbounded, and the row is
   * asserted to hold a total well past the per-request ceiling.
   */
  it('lets a row grow past the single-serving ceiling as it absorbs merges', async () => {
    const foodName = unName();

    const first = await post({ foodName, calories: MAX_KCAL, date: laNoche30, ...dia30 });
    expect(first.status).toBe(201);

    const second = await post({ foodName, calories: MAX_KCAL, date: laNoche30, ...dia30 });
    expect(second.status).toBe(200);
    expect(second.body.merged).toBe(true);

    const rows = await filas(foodName);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.calories).toBe(MAX_KCAL * 2);
  });

  /** An ordinary meal is nowhere near any of these bounds and must stay untouched. */
  it('still stores an ordinary meal', async () => {
    const res = await post({
      foodName: unName(), grams: 150, calories: 320, protein: 24, carbs: 40, fat: 6,
      date: laNoche30, ...dia30,
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ grams: 150, calories: 320, protein: 24, carbs: 40, fat: 6 });
  });
});
