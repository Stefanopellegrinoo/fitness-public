import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '../lib/prisma';
import { upsertFoods, type SeedFood } from '../lib/nutrition/foodSeed';

const stamp = Date.now();
const extId = `test:seed:${stamp}`;

const sample: SeedFood[] = [
  {
    externalId: extId,
    name: `Pechuga de Pollo Test ${stamp}`,
    caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6,
    source: 'GENERIC',
  },
];

describe('upsertFoods', () => {
  afterAll(async () => {
    await prisma.foodItem.deleteMany({ where: { externalId: extId } });
  });

  it('inserts a food with source GENERIC and gram defaults', async () => {
    const n = await upsertFoods(prisma, sample);
    expect(n).toBe(1);
    const food = await prisma.foodItem.findUnique({ where: { externalId: extId } });
    expect(food?.source).toBe('GENERIC');
    expect(food?.isGramBased).toBe(true);
    expect(food?.servingName).toBe('100g');
    expect(food?.caloriesPer100g).toBe(165);
  });

  it('is idempotent — running twice does not duplicate and updates values', async () => {
    await upsertFoods(prisma, sample);
    const updated = [{ ...sample[0], caloriesPer100g: 170 }];
    await upsertFoods(prisma, updated);
    const rows = await prisma.foodItem.findMany({ where: { externalId: extId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].caloriesPer100g).toBe(170);
  });
});
