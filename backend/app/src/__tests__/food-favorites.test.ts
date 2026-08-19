import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

describe('FoodFavorite model', () => {
  let userId: string;
  let foodItemId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `fav.test.${stamp}@example.com`, password: 'password123', name: 'Fav Tester' },
    });
    userId = user.id;
    const food = await prisma.foodItem.create({
      data: { name: `Test Food ${stamp}`, externalId: `test:fav:${stamp}`, source: 'GENERIC' },
    });
    foodItemId = food.id;
  });

  afterAll(async () => {
    await prisma.foodFavorite.deleteMany({ where: { userId } });
    await prisma.foodItem.delete({ where: { id: foodItemId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('creates a favorite linking a user and a food', async () => {
    const fav = await prisma.foodFavorite.create({ data: { userId, foodItemId } });
    expect(fav.id).toBeDefined();
    expect(fav.userId).toBe(userId);
    expect(fav.foodItemId).toBe(foodItemId);
  });

  it('rejects a duplicate (userId, foodItemId) with P2002', async () => {
    let code: string | undefined;
    try {
      await prisma.foodFavorite.create({ data: { userId, foodItemId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) code = e.code;
    }
    expect(code).toBe('P2002');
  });

  it('exposes GENERIC as a valid FoodSource', async () => {
    const food = await prisma.foodItem.findUnique({ where: { id: foodItemId } });
    expect(food?.source).toBe('GENERIC');
  });
});
