import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

describe('/api/foods recent + favorites', () => {
  let userId: string;
  let authToken: string;
  let food1Id: string;
  let food2Id: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `foods.recent.${stamp}@example.com`, password: 'password123', name: 'Foods Recent Tester' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;

    const food1 = await prisma.foodItem.create({
      data: {
        name: `Recent Food A ${stamp}`, source: 'GENERIC', externalId: `generic:recent-a-${stamp}`,
        caloriesPer100g: 100, proteinPer100g: 5, carbsPer100g: 10, fatPer100g: 2,
      },
    });
    const food2 = await prisma.foodItem.create({
      data: {
        name: `Recent Food B ${stamp}`, source: 'GENERIC', externalId: `generic:recent-b-${stamp}`,
        caloriesPer100g: 120, proteinPer100g: 6, carbsPer100g: 12, fatPer100g: 3,
      },
    });
    food1Id = food1.id;
    food2Id = food2.id;

    const now = Date.now();
    // food1: two entries (oldest + newest); food2: one entry in between.
    await prisma.nutritionEntry.create({
      data: { userId, foodItemId: food1Id, foodName: food1.name, grams: 100, mealCategory: 'Desayuno', date: new Date(now - 1000 * 60 * 60) },
    });
    await prisma.nutritionEntry.create({
      data: { userId, foodItemId: food1Id, foodName: food1.name, grams: 150, mealCategory: 'Almuerzo', date: new Date(now) },
    });
    await prisma.nutritionEntry.create({
      data: { userId, foodItemId: food2Id, foodName: food2.name, grams: 80, mealCategory: 'Cena', date: new Date(now - 1000 * 60 * 60 * 2) },
    });
  });

  afterAll(async () => {
    await prisma.nutritionEntry.deleteMany({ where: { userId } });
    await prisma.foodFavorite.deleteMany({ where: { userId } });
    await prisma.foodItem.deleteMany({ where: { id: { in: [food1Id, food2Id] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('GET /recent returns distinct recently-logged foods, most recent first', async () => {
    const res = await request(app)
      .get('/api/foods/recent')
      .set('Cookie', [`auth_token=${authToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe(food1Id);
    expect(res.body.data[1].id).toBe(food2Id);
  });

  it('GET /recent?limit=-5 clamps to a positive limit instead of reverse-paginating', async () => {
    const defaultRes = await request(app)
      .get('/api/foods/recent')
      .set('Cookie', [`auth_token=${authToken}`]);

    const res = await request(app)
      .get('/api/foods/recent?limit=-5')
      .set('Cookie', [`auth_token=${authToken}`]);

    expect(res.status).toBe(200);
    // A negative limit clamps to the minimum of 1, not Prisma's reverse-pagination
    // (which would surface the oldest food first instead of the newest).
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].id).toBe(defaultRes.body.data[0].id);
    expect(res.body.data[0].id).toBe(food1Id);
  });

  it('favorites POST -> GET -> DELETE round trip, idempotent on repeat POST', async () => {
    const cookie = [`auth_token=${authToken}`];

    const post1 = await request(app).post('/api/foods/favorites').set('Cookie', cookie).send({ foodItemId: food1Id });
    expect(post1.status).toBe(201);

    // Idempotent: second POST must not create a duplicate.
    const post2 = await request(app).post('/api/foods/favorites').set('Cookie', cookie).send({ foodItemId: food1Id });
    expect(post2.status).toBe(201);

    const getRes = await request(app).get('/api/foods/favorites').set('Cookie', cookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toHaveLength(1);
    expect(getRes.body.data[0].id).toBe(food1Id);

    const del = await request(app).delete(`/api/foods/favorites/${food1Id}`).set('Cookie', cookie);
    expect(del.status).toBe(204);

    const afterDel = await request(app).get('/api/foods/favorites').set('Cookie', cookie);
    expect(afterDel.body.data).toHaveLength(0);
  });

  it('POST /favorites with an invalid foodItemId returns a 400 validation error', async () => {
    const res = await request(app)
      .post('/api/foods/favorites')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ foodItemId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Validation error');
  });
});
