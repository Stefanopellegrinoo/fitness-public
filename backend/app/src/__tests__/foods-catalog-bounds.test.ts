import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * The per-100g figures the catalog accepts, and why they need a ceiling.
 *
 * `FoodItem` has NO `userId`: it is one shared catalog, and every authenticated
 * user writes the copy that every other user reads. So a value accepted here is
 * not a value one caller harms themselves with — it is a value that changes what
 * everyone else's recipes compute to.
 *
 * MEASURED before the fix, end to end against the real database:
 *
 *   POST /api/foods   {caloriesPer100g: 1e308}                        -> 201
 *   POST /api/recipes {servings: 1, ingredients: [{<that>, grams: 1000}]} -> 201
 *      nutrition.total.calories   = null
 *      hasIncompleteMacros        = false
 *
 * That `null` is the part worth being precise about, because the obvious reading
 * of it is wrong. It is NOT a missing macro, and `hasIncompleteMacros: false` is
 * NOT a bug: the value was present. `1e308 * (1000/100)` is 1e309, which is past
 * `Number.MAX_VALUE`, so the product is `Infinity` — and `JSON.stringify` has no
 * encoding for Infinity, so it emits `null`. The catalog figure is finite on the
 * way in and the ARITHMETIC is what leaves the representable range.
 *
 * It does not stop at the API. `recipe-picker.tsx` rounds that `null` with
 * `Math.round(null)`, which is 0, and logs the recipe to the diary as 0 kcal —
 * no error, and no incomplete-macros badge either, because by the server's
 * reckoning nothing was missing.
 *
 * The ceiling is physical, and it is the one the OpenFoodFacts importer already
 * enforces on third-party rows (`offMacros.ts`): the densest a food can be is
 * pure fat at 9 kcal per gram, so 100 g of it holds at most 900 kcal, and a
 * macro is a WEIGHT inside those 100 g, so no macro can exceed 100 g. Applying
 * it here closes the asymmetry that let a logged-in user write what a stranger's
 * API could not.
 */
describe('/api/foods catalog bounds', () => {
  let userId: string;
  let authToken: string;
  const stamp = Date.now();
  let seq = 0;
  // The catalog outlives this suite's user, so anything created here is tracked
  // and removed by hand — fixtures leaking into the shared catalog is the exact
  // defect PR #50 was opened for.
  const foodItemIds: string[] = [];

  // The ceilings the route is expected to enforce. Restated rather than
  // imported: a test that reads its expectation out of the implementation cannot
  // tell the two apart, and would follow the route wherever it moved.
  const MAX_KCAL_PER_100G = 900;
  const MAX_MACRO_PER_100G = 100;

  // What the OTHER schemas already cap, and what this suite's last test needs in
  // order to bound the worst legal recipe.
  const MAX_GRAMS = 100000;
  const MAX_INGREDIENTS = 50;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `foods.bounds.${stamp}@example.com`, password: 'password123', name: 'Catalog Bounds Tester' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterAll(async () => {
    await prisma.recipe.deleteMany({ where: { userId } });
    await prisma.foodItem.deleteMany({ where: { id: { in: foodItemIds } } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const unName = () => `bounds food ${stamp} ${seq++}`;

  const postFood = (body: Record<string, unknown>) =>
    request(app)
      .post('/api/foods')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ name: unName(), ...body });

  /** Creates through the route and tracks the row, so the ceiling is exercised. */
  const crearAlimento = async (body: Record<string, unknown>) => {
    const res = await postFood(body);
    expect(res.status).toBe(201);
    foodItemIds.push(res.body.data.id);
    return res.body.data;
  };

  const postRecipe = (body: Record<string, unknown>) =>
    request(app).post('/api/recipes').set('Cookie', [`auth_token=${authToken}`]).send(body);

  const filas = (name: string) => prisma.foodItem.findMany({ where: { name } });

  /**
   * The hole itself. Asserted on all four columns, because the ceiling was
   * missing from all four and a fix that lands on `caloriesPer100g` alone leaves
   * the same overflow reachable through protein.
   *
   * Both halves matter: the request is refused, AND nothing is written — a 400
   * that still persisted the row would leave the shared catalog poisoned anyway.
   */
  it('refuses a per-100g figure no food could have, on every macro column', async () => {
    for (const col of ['caloriesPer100g', 'proteinPer100g', 'carbsPer100g', 'fatPer100g'] as const) {
      const name = unName();

      const res = await request(app)
        .post('/api/foods')
        .set('Cookie', [`auth_token=${authToken}`])
        .send({ name, [col]: 1e308 });

      expect(res.status, col).toBe(400);
      expect(await filas(name), col).toHaveLength(0);
    }
  });

  /**
   * A negative is the same defect from the other side and needs its own case:
   * it never overflows, so no finiteness guard downstream would ever catch it.
   * MEASURED before the fix: `carbsPer100g: -5` at 1000 g gave a recipe
   * `carbs: -50`, a food that removes carbohydrates from the day it is logged
   * into.
   */
  it('refuses a negative per-100g figure, which no arithmetic guard downstream would catch', async () => {
    for (const col of ['caloriesPer100g', 'proteinPer100g', 'carbsPer100g', 'fatPer100g'] as const) {
      const name = unName();

      const res = await request(app)
        .post('/api/foods')
        .set('Cookie', [`auth_token=${authToken}`])
        .send({ name, [col]: -5 });

      expect(res.status, col).toBe(400);
      expect(await filas(name), col).toHaveLength(0);
    }
  });

  /**
   * The edge from both sides, so the bound cannot drift without a test saying
   * so. Pure fat is the densest a food gets, and it is a real thing a user
   * legitimately enters — the ceiling has to admit it.
   */
  it('accepts the densest food that exists, and refuses a calorie more', async () => {
    const justo = await postFood({ caloriesPer100g: MAX_KCAL_PER_100G });
    expect(justo.status).toBe(201);
    foodItemIds.push(justo.body.data.id);

    const pasado = await postFood({ caloriesPer100g: MAX_KCAL_PER_100G + 1 });
    expect(pasado.status).toBe(400);
  });

  it('accepts a macro that fills the whole 100 g, and refuses a gram more', async () => {
    for (const col of ['proteinPer100g', 'carbsPer100g', 'fatPer100g'] as const) {
      const justo = await postFood({ [col]: MAX_MACRO_PER_100G });
      expect(justo.status, col).toBe(201);
      foodItemIds.push(justo.body.data.id);

      const pasado = await postFood({ [col]: MAX_MACRO_PER_100G + 1 });
      expect(pasado.status, col).toBe(400);
    }
  });

  /**
   * The guard must be a guard, not a blanket refusal.
   *
   * Zero is the case a stricter rule would have broken: `hasSaneMacros` in
   * `offMacros.ts` demands `kcal > 0`, which is right for THIRD-PARTY rows where
   * a zero almost always means "OpenFoodFacts had no figure", and wrong for a
   * user typing in black coffee or water. So the catalog route bounds the range
   * without inheriting that test, and this case pins the difference as
   * deliberate.
   */
  it('still accepts an ordinary food, and a genuinely zero-calorie one', async () => {
    const comun = await crearAlimento({
      caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6,
    });
    expect(comun).toMatchObject({ caloriesPer100g: 165, proteinPer100g: 31, fatPer100g: 3.6 });

    const agua = await crearAlimento({
      caloriesPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0,
    });
    expect(agua.caloriesPer100g).toBe(0);
  });

  /**
   * THE PROPERTY the ceiling actually buys, stated end to end.
   *
   * A recipe's macros are the catalog figure times the serving, summed over the
   * ingredients, and the other two factors were ALREADY bounded — `grams` at
   * MAX_GRAMS and the list at 50 entries. The catalog figure was the only
   * unbounded one, which is why the product could leave the representable range
   * at all.
   *
   * So this builds the worst recipe the remaining schemas still permit — 50
   * ingredients of the densest legal food, each at the maximum serving — and
   * pins that every figure that comes back is a finite JSON number. At
   * 50 * 900 * (100000/100) the total is 45,000,000 kcal: absurd as food,
   * ordinary as a double, and about 1e301 times short of overflowing one.
   *
   * `null` is asserted against explicitly because that is the exact shape the
   * failure took: not an error, not a NaN, just a JSON null where a number
   * belonged.
   */
  it('leaves no legal recipe able to overflow, at the worst serving the other schemas allow', async () => {
    const denso = await crearAlimento({
      caloriesPer100g: MAX_KCAL_PER_100G,
      proteinPer100g: MAX_MACRO_PER_100G,
      carbsPer100g: MAX_MACRO_PER_100G,
      fatPer100g: MAX_MACRO_PER_100G,
    });

    const res = await postRecipe({
      name: `bounds recipe ${stamp}`,
      servings: 1,
      ingredients: Array.from({ length: MAX_INGREDIENTS }, () => ({
        foodItemId: denso.id,
        grams: MAX_GRAMS,
      })),
    });

    expect(res.status).toBe(201);

    const { total, per100g, perServing } = res.body.data.nutrition;
    for (const set of [total, per100g, perServing]) {
      for (const macro of ['calories', 'protein', 'carbs', 'fat'] as const) {
        expect(set[macro]).not.toBeNull();
        expect(Number.isFinite(set[macro])).toBe(true);
      }
    }

    expect(total.calories).toBe(MAX_INGREDIENTS * MAX_KCAL_PER_100G * (MAX_GRAMS / 100));
    // per100g divides by the same grams it multiplied by, so it lands back on
    // the catalog figure exactly — the clearest statement that nothing drifted.
    expect(per100g.calories).toBeCloseTo(MAX_KCAL_PER_100G, 6);
  });
});
