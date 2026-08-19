import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

describe('/api/recipes create + list', () => {
  let userId: string;
  let authToken: string;
  let foodAId: string;
  let foodBId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `recipes.crud.${stamp}@example.com`, password: 'password123', name: 'Recipes CRUD Tester' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;

    const foodA = await prisma.foodItem.create({
      data: {
        name: `Recipe Food A ${stamp}`, source: 'GENERIC', externalId: `generic:recipe-a-${stamp}`,
        caloriesPer100g: 100, proteinPer100g: 10, carbsPer100g: 20, fatPer100g: 1,
      },
    });
    const foodB = await prisma.foodItem.create({
      data: {
        name: `Recipe Food B ${stamp}`, source: 'GENERIC', externalId: `generic:recipe-b-${stamp}`,
        caloriesPer100g: 50, proteinPer100g: 4, carbsPer100g: 6, fatPer100g: 2,
      },
    });
    foodAId = foodA.id;
    foodBId = foodB.id;
  });

  afterAll(async () => {
    await prisma.recipe.deleteMany({ where: { userId } });
    await prisma.foodItem.deleteMany({ where: { id: { in: [foodAId, foodBId] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const auth = (req: request.Test) => req.set('Cookie', [`auth_token=${authToken}`]);

  it('POST creates a recipe and returns derived macros', async () => {
    const res = await auth(request(app).post('/api/recipes')).send({
      name: `Guiso ${stamp}`,
      servings: 4,
      ingredients: [
        { foodItemId: foodAId, grams: 200 },
        { foodItemId: foodBId, grams: 100 },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe(`Guiso ${stamp}`);
    expect(res.body.data.ingredients).toHaveLength(2);
    expect(res.body.data.nutrition.totalGrams).toBe(300);
    expect(res.body.data.nutrition.total.calories).toBeCloseTo(250);
    expect(res.body.data.nutrition.perServing.calories).toBeCloseTo(62.5);
    expect(res.body.data.nutrition.gramsPerServing).toBeCloseTo(75);
    expect(res.body.data.nutrition.hasIncompleteMacros).toBe(false);
  });

  it('POST rejects a recipe with no ingredients', async () => {
    const res = await auth(request(app).post('/api/recipes')).send({
      name: 'Vacia', servings: 1, ingredients: [],
    });
    expect(res.status).toBe(400);
  });

  it('POST rejects servings below 1', async () => {
    const res = await auth(request(app).post('/api/recipes')).send({
      name: 'Cero', servings: 0, ingredients: [{ foodItemId: foodAId, grams: 100 }],
    });
    expect(res.status).toBe(400);
  });

  /**
   * The same ceiling `POST /api/nutrition` puts on a serving. Without it the
   * ingredient list took `1e308` grams, and the recipe's own figures left the
   * range a double can hold — `Infinity` here, or `NaN` once `totalGrams`
   * overflowed too and `per100g` became `Infinity * 0`.
   *
   * Neither one travels: `JSON.stringify` emits `null` for both, the picker
   * rounds it to 0, and the recipe is logged as zero calories with no error
   * anywhere. See `limits.ts` for the measured figures.
   */
  it('POST rejects an ingredient above the gram ceiling', async () => {
    const res = await auth(request(app).post('/api/recipes')).send({
      name: 'Desbordada', servings: 1,
      ingredients: [{ foodItemId: foodAId, grams: 1e308 }],
    });
    expect(res.status).toBe(400);
  });

  /**
   * The SHAPE of the rejection, not just the status.
   *
   * Every other validating route in this API answers
   * `details: parseResult.error.flatten()` — ten of them, in nutrition, foods,
   * routines, exercises, body-metrics and user. Recipes was the lone outlier,
   * shipping `error.issues`: a different structure, so a client that learned to
   * read `fieldErrors` from any other route gets `undefined` from this one and
   * falls back to a raw dump.
   */
  it('answers a validation error in the same shape as every other route', async () => {
    const res = await auth(request(app).post('/api/recipes')).send({
      name: 'Invalida', servings: 0, ingredients: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toHaveProperty('fieldErrors');
    expect(res.body.error.details).toHaveProperty('formErrors');
  });

  it('POST accepts an ingredient exactly at the ceiling', async () => {
    const res = await auth(request(app).post('/api/recipes')).send({
      name: `Al limite ${stamp}`, servings: 1,
      ingredients: [{ foodItemId: foodAId, grams: 100000 }],
    });
    expect(res.status).toBe(201);
  });

  it('POST rejects an unknown foodItemId with 400, not 500', async () => {
    const res = await auth(request(app).post('/api/recipes')).send({
      name: 'Fantasma',
      servings: 1,
      ingredients: [{ foodItemId: '00000000-0000-4000-8000-000000000000', grams: 100 }],
    });
    expect(res.status).toBe(400);
  });

  it('GET lists the user recipes with derived macros and no ingredient array', async () => {
    const res = await auth(request(app).get('/api/recipes'));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const item = res.body.data.find((r: any) => r.name === `Guiso ${stamp}`);
    expect(item).toBeDefined();
    expect(item.ingredientCount).toBe(2);
    expect(item.ingredients).toBeUndefined();
    expect(item.nutrition.perServing.calories).toBeCloseTo(62.5);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('GET requires authentication', async () => {
    const res = await request(app).get('/api/recipes');
    expect(res.status).toBe(401);
  });

  it('GET :id returns the recipe with its ingredients', async () => {
    const created = await auth(request(app).post('/api/recipes')).send({
      name: `Detalle ${stamp}`, servings: 2,
      ingredients: [{ foodItemId: foodAId, grams: 150 }],
    });

    const res = await auth(request(app).get(`/api/recipes/${created.body.data.id}`));

    expect(res.status).toBe(200);
    expect(res.body.data.ingredients).toHaveLength(1);
    expect(res.body.data.ingredients[0].foodItem.name).toBe(`Recipe Food A ${stamp}`);
    expect(res.body.data.nutrition.totalGrams).toBe(150);
  });

  it('GET :id returns 404 for a recipe that does not exist', async () => {
    const res = await auth(request(app).get('/api/recipes/00000000-0000-4000-8000-000000000000'));
    expect(res.status).toBe(404);
  });

  it('PATCH replaces the ingredient set completely', async () => {
    const created = await auth(request(app).post('/api/recipes')).send({
      name: `Reemplazo ${stamp}`, servings: 1,
      ingredients: [{ foodItemId: foodAId, grams: 100 }, { foodItemId: foodBId, grams: 100 }],
    });

    const res = await auth(request(app).patch(`/api/recipes/${created.body.data.id}`)).send({
      ingredients: [{ foodItemId: foodBId, grams: 250 }],
    });

    expect(res.status).toBe(200);
    expect(res.body.data.ingredients).toHaveLength(1);
    expect(res.body.data.ingredients[0].foodItemId).toBe(foodBId);
    expect(res.body.data.nutrition.totalGrams).toBe(250);

    // los ingredientes viejos no quedaron huerfanos en la tabla
    const orphans = await prisma.recipeIngredient.count({
      where: { recipeId: created.body.data.id, foodItemId: foodAId },
    });
    expect(orphans).toBe(0);
  });

  it('PATCH updates name and servings without touching ingredients', async () => {
    const created = await auth(request(app).post('/api/recipes')).send({
      name: `Renombrar ${stamp}`, servings: 1,
      ingredients: [{ foodItemId: foodAId, grams: 100 }],
    });

    const res = await auth(request(app).patch(`/api/recipes/${created.body.data.id}`)).send({
      name: `Renombrada ${stamp}`, servings: 5,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe(`Renombrada ${stamp}`);
    expect(res.body.data.servings).toBe(5);
    expect(res.body.data.ingredients).toHaveLength(1);
    expect(res.body.data.nutrition.gramsPerServing).toBeCloseTo(20);
  });

  it('PATCH with only a name does NOT reset servings', async () => {
    const created = await auth(request(app).post('/api/recipes')).send({
      name: `Conserva porciones ${stamp}`, servings: 8,
      ingredients: [{ foodItemId: foodAId, grams: 800 }],
    });

    const res = await auth(request(app).patch(`/api/recipes/${created.body.data.id}`)).send({
      name: `Solo renombrada ${stamp}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.servings).toBe(8); // no vuelve a 1 por el default de zod
    expect(res.body.data.nutrition.gramsPerServing).toBeCloseTo(100);
  });

  it('PATCH rejects an empty ingredient array', async () => {
    const created = await auth(request(app).post('/api/recipes')).send({
      name: `Vaciar ${stamp}`, servings: 1,
      ingredients: [{ foodItemId: foodAId, grams: 100 }],
    });

    const res = await auth(request(app).patch(`/api/recipes/${created.body.data.id}`)).send({
      ingredients: [],
    });
    expect(res.status).toBe(400);
  });

  it('DELETE removes the recipe and cascades its ingredients', async () => {
    const created = await auth(request(app).post('/api/recipes')).send({
      name: `Borrar ${stamp}`, servings: 1,
      ingredients: [{ foodItemId: foodAId, grams: 100 }],
    });
    const id = created.body.data.id;

    const res = await auth(request(app).delete(`/api/recipes/${id}`));
    expect(res.status).toBe(204);

    expect(await prisma.recipe.count({ where: { id } })).toBe(0);
    expect(await prisma.recipeIngredient.count({ where: { recipeId: id } })).toBe(0);
  });

  it('DELETE returns 404 for a recipe that does not exist', async () => {
    const res = await auth(request(app).delete('/api/recipes/00000000-0000-4000-8000-000000000000'));
    expect(res.status).toBe(404);
  });
});
