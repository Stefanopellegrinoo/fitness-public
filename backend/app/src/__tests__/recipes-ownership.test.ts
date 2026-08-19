import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

describe('/api/recipes ownership isolation', () => {
  let userAId: string;
  let userBId: string;
  let tokenA: string;
  let tokenB: string;
  let foodId: string;
  let recipeOfAId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const userA = await prisma.user.create({
      data: { email: `recipes.owner.a.${stamp}@example.com`, password: 'password123', name: 'Owner A' },
    });
    const userB = await prisma.user.create({
      data: { email: `recipes.owner.b.${stamp}@example.com`, password: 'password123', name: 'Owner B' },
    });
    userAId = userA.id;
    userBId = userB.id;
    tokenA = authService.generateTokens({ userId: userA.id, email: userA.email }).accessToken;
    tokenB = authService.generateTokens({ userId: userB.id, email: userB.email }).accessToken;

    const food = await prisma.foodItem.create({
      data: {
        name: `Owner Food ${stamp}`, source: 'GENERIC', externalId: `generic:owner-${stamp}`,
        caloriesPer100g: 100, proteinPer100g: 10, carbsPer100g: 20, fatPer100g: 1,
      },
    });
    foodId = food.id;

    const recipeOfA = await prisma.recipe.create({
      data: {
        userId: userAId, name: `Secreta de A ${stamp}`, servings: 1,
        ingredients: { create: [{ foodItemId: foodId, grams: 100 }] },
      },
    });
    recipeOfAId = recipeOfA.id;
  });

  afterAll(async () => {
    await prisma.recipe.deleteMany({ where: { userId: { in: [userAId, userBId] } } });
    await prisma.foodItem.delete({ where: { id: foodId } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  });

  const asB = (req: request.Test) => req.set('Cookie', [`auth_token=${tokenB}`]);

  it('B does not see the recipes of A in the list', async () => {
    const res = await asB(request(app).get('/api/recipes'));
    expect(res.status).toBe(200);
    expect(res.body.data.find((r: any) => r.id === recipeOfAId)).toBeUndefined();
  });

  it('B gets 404 (not 403) reading a recipe of A', async () => {
    const res = await asB(request(app).get(`/api/recipes/${recipeOfAId}`));
    expect(res.status).toBe(404);
  });

  it('B gets 404 patching a recipe of A, and the recipe is untouched', async () => {
    const res = await asB(request(app).patch(`/api/recipes/${recipeOfAId}`)).send({ name: 'Hackeada' });
    expect(res.status).toBe(404);

    const untouched = await prisma.recipe.findUnique({ where: { id: recipeOfAId } });
    expect(untouched!.name).toBe(`Secreta de A ${stamp}`);
  });

  it('B gets 404 deleting a recipe of A, and the recipe survives', async () => {
    const res = await asB(request(app).delete(`/api/recipes/${recipeOfAId}`));
    expect(res.status).toBe(404);
    expect(await prisma.recipe.count({ where: { id: recipeOfAId } })).toBe(1);
  });

  it('a recipe is always created for the token owner, never for a userId in the body', async () => {
    const res = await asB(request(app).post('/api/recipes')).send({
      userId: userAId, // intento de suplantacion
      name: `Intento de B ${stamp}`,
      servings: 1,
      ingredients: [{ foodItemId: foodId, grams: 50 }],
    });

    expect(res.status).toBe(201);
    const created = await prisma.recipe.findUnique({ where: { id: res.body.data.id } });
    expect(created!.userId).toBe(userBId);
  });
});
