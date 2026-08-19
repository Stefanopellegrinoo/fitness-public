// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/api/client', () => ({ apiClient: vi.fn() }));

import { apiClient } from '@/lib/api/client';
import {
  getFoodByBarcode,
  getRecentFoods,
  getFavorites,
  addFavorite,
  removeFavorite,
} from './food.service';

const mockedClient = vi.mocked(apiClient);

const sampleFood = {
  id: 'food-1',
  name: 'Banana',
  isGramBased: true,
  caloriesPer100g: 89,
  proteinPer100g: 1.1,
  carbsPer100g: 23,
  fatPer100g: 0.3,
};

describe('foodService.getFoodByBarcode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the food when the barcode is found (200)', async () => {
    mockedClient.mockResolvedValue(
      new Response(JSON.stringify({ data: sampleFood }), { status: 200 })
    );

    const food = await getFoodByBarcode('3017620422003');

    expect(food).toEqual(sampleFood);
    expect(mockedClient.mock.calls[0][0]).toBe('/backend-api/foods/barcode/3017620422003');
    expect(mockedClient.mock.calls[0][1]?.method).toBe('GET');
  });

  it('returns null when the barcode is not found (404)', async () => {
    mockedClient.mockResolvedValue(new Response(null, { status: 404 }));

    const food = await getFoodByBarcode('0000000000000');

    expect(food).toBeNull();
    expect(vi.mocked(apiClient).mock.calls[0][0]).toContain('/foods/barcode/');
    expect(vi.mocked(apiClient).mock.calls[0][1]?.method).toBe('GET');
  });
});

describe('foodService.getRecentFoods', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the recent foods array', async () => {
    mockedClient.mockResolvedValue(
      new Response(JSON.stringify({ data: [sampleFood] }), { status: 200 })
    );

    const foods = await getRecentFoods();

    expect(foods).toEqual([sampleFood]);
    expect(mockedClient.mock.calls[0][0]).toBe('/backend-api/foods/recent?limit=10');
  });
});

describe('foodService.getFavorites', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the favorites array', async () => {
    mockedClient.mockResolvedValue(
      new Response(JSON.stringify({ data: [sampleFood] }), { status: 200 })
    );

    const foods = await getFavorites();

    expect(foods).toEqual([sampleFood]);
    expect(mockedClient.mock.calls[0][0]).toBe('/backend-api/foods/favorites');
  });
});

describe('foodService.addFavorite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the foodItemId to /foods/favorites', async () => {
    mockedClient.mockResolvedValue(
      new Response(JSON.stringify({ data: {} }), { status: 201 })
    );

    await addFavorite('food-1');

    expect(mockedClient.mock.calls[0][0]).toBe('/backend-api/foods/favorites');
    expect(mockedClient.mock.calls[0][1]?.method).toBe('POST');
    expect(mockedClient.mock.calls[0][1]?.body).toBe(JSON.stringify({ foodItemId: 'food-1' }));
  });
});

describe('foodService.removeFavorite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('DELETEs /foods/favorites/:id', async () => {
    mockedClient.mockResolvedValue(new Response(null, { status: 204 }));

    await removeFavorite('food-1');

    expect(mockedClient.mock.calls[0][0]).toBe('/backend-api/foods/favorites/food-1');
    expect(mockedClient.mock.calls[0][1]?.method).toBe('DELETE');
  });
});
