import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

describe('/api/foods auth gate', () => {
  let userId: string;
  let authToken: string;
  const stamp = Date.now();
  const createdFoodIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `foods.auth.${stamp}@example.com`, password: 'password123', name: 'Foods Auth Tester' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterAll(async () => {
    if (createdFoodIds.length) {
      await prisma.foodItem.deleteMany({ where: { id: { in: createdFoodIds } } });
    }
    await prisma.user.delete({ where: { id: userId } });
  });

  it('returns 401 without an auth cookie', async () => {
    const res = await request(app).get('/api/foods');
    expect(res.status).toBe(401);
  });

  it('returns 200 with an array payload when authenticated', async () => {
    const res = await request(app).get('/api/foods').set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });

  it('still allows creating a food when authenticated (POST /)', async () => {
    const res = await request(app)
      .post('/api/foods')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ name: `Auth Created Food ${stamp}`, caloriesPer100g: 100 });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    createdFoodIds.push(res.body.data.id);
  });
});
