import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

describe('GET /api/recipes?q=', () => {
  let userId: string;
  let otherUserId: string;
  let authToken: string;
  let foodId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `recipes.search.${stamp}@example.com`, password: 'password123', name: 'Search Tester' },
    });
    const other = await prisma.user.create({
      data: { email: `recipes.search.other.${stamp}@example.com`, password: 'password123', name: 'Other' },
    });
    userId = user.id;
    otherUserId = other.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;

    const food = await prisma.foodItem.create({
      data: {
        name: `Search Food ${stamp}`, source: 'GENERIC', externalId: `generic:search-${stamp}`,
        caloriesPer100g: 100, proteinPer100g: 10, carbsPer100g: 20, fatPer100g: 1,
      },
    });
    foodId = food.id;

    const make = (uid: string, name: string) =>
      prisma.recipe.create({
        data: { userId: uid, name, servings: 1, ingredients: { create: [{ foodItemId: foodId, grams: 100 }] } },
      });

    await make(userId, `Tarta de atun ${stamp}`);
    await make(userId, `Guiso de lentejas ${stamp}`);
    await make(otherUserId, `Tarta ajena ${stamp}`);
  });

  afterAll(async () => {
    await prisma.recipe.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.foodItem.delete({ where: { id: foodId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  const auth = (req: request.Test) => req.set('Cookie', [`auth_token=${authToken}`]);

  it('filters recipes by name', async () => {
    const res = await auth(request(app).get('/api/recipes?q=tarta'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe(`Tarta de atun ${stamp}`);
  });

  it('is case insensitive', async () => {
    const res = await auth(request(app).get('/api/recipes?q=TARTA'));
    expect(res.body.data).toHaveLength(1);
  });

  it('matches on a substring, not only a prefix', async () => {
    const res = await auth(request(app).get('/api/recipes?q=lentejas'));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe(`Guiso de lentejas ${stamp}`);
  });

  it('never returns recipes of other users', async () => {
    const res = await auth(request(app).get('/api/recipes?q=ajena'));
    expect(res.body.data).toHaveLength(0);
  });

  it('returns everything when q is absent', async () => {
    const res = await auth(request(app).get('/api/recipes'));
    expect(res.body.data).toHaveLength(2);
  });

  it('reflects the filter in the pagination total, not just in the page', async () => {
    const res = await auth(request(app).get('/api/recipes?q=tarta'));
    expect(res.body.pagination.total).toBe(1);
  });
});
