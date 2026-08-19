import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  mapOffProductToSeedFood,
  fetchOffProductByBarcode,
  searchOffProducts,
  type OffProduct,
} from '../lib/nutrition/openfoodfacts';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const validProduct: OffProduct = {
  code: '7501234567890',
  product_name: 'Yogur Natural',
  brands: 'La Serenísima, Otra Marca',
  nutriments: {
    'energy-kcal_100g': 60,
    'proteins_100g': 4,
    'carbohydrates_100g': 7,
    'fat_100g': 3,
  },
};

describe('mapOffProductToSeedFood', () => {
  it('maps a valid product to a SeedFood with off:code externalId and OPEN_FOOD_FACTS source', () => {
    const result = mapOffProductToSeedFood(validProduct);
    expect(result).not.toBeNull();
    expect(result!.externalId).toBe('off:7501234567890');
    expect(result!.source).toBe('OPEN_FOOD_FACTS');
    expect(result!.name).toBe('Yogur Natural');
    expect(result!.brand).toBe('La Serenísima');
    expect(result!.barcode).toBe('7501234567890');
    expect(result!.caloriesPer100g).toBe(60);
    expect(result!.proteinPer100g).toBe(4);
    expect(result!.isGramBased).toBe(true);
  });

  it('returns null when a macro is missing', () => {
    const missing: OffProduct = {
      ...validProduct,
      nutriments: { 'energy-kcal_100g': 60, 'carbohydrates_100g': 7, 'fat_100g': 3 },
    };
    expect(mapOffProductToSeedFood(missing)).toBeNull();
  });

  it('returns a null brand when brands is empty', () => {
    const noBrand: OffProduct = { ...validProduct, brands: '' };
    const result = mapOffProductToSeedFood(noBrand);
    expect(result).not.toBeNull();
    expect(result!.brand).toBeNull();
  });

  it('maps an array brands (Search-a-licious shape) using the first element', () => {
    const arrayBrand: OffProduct = { ...validProduct, brands: ['Marca A', 'Marca B'] };
    const result = mapOffProductToSeedFood(arrayBrand);
    expect(result).not.toBeNull();
    expect(result!.brand).toBe('Marca A');
  });

  it('normalizes embedded whitespace/newlines in the product name', () => {
    const messy: OffProduct = { ...validProduct, product_name: '5053\nLECHE   SEMIDESNATADA' };
    const result = mapOffProductToSeedFood(messy);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('5053 LECHE SEMIDESNATADA');
  });
});

describe('fetchOffProductByBarcode', () => {
  it('returns a SeedFood when OFF responds with status 1 and a product', async () => {
    server.use(
      http.get('https://world.openfoodfacts.org/api/v2/product/*', () =>
        HttpResponse.json({ status: 1, product: validProduct })
      )
    );
    const result = await fetchOffProductByBarcode('7501234567890');
    expect(result).not.toBeNull();
    expect(result!.externalId).toBe('off:7501234567890');
    expect(result!.source).toBe('OPEN_FOOD_FACTS');
  });

  it('returns null when OFF responds with status 0', async () => {
    server.use(
      http.get('https://world.openfoodfacts.org/api/v2/product/*', () =>
        HttpResponse.json({ status: 0 })
      )
    );
    const result = await fetchOffProductByBarcode('0000000000000');
    expect(result).toBeNull();
  });

  it('returns null when OFF responds with HTTP 500', async () => {
    server.use(
      http.get('https://world.openfoodfacts.org/api/v2/product/*', () =>
        new HttpResponse(null, { status: 500 })
      )
    );
    const result = await fetchOffProductByBarcode('7501234567890');
    expect(result).toBeNull();
  });

  it('returns null on a network error', async () => {
    server.use(
      http.get('https://world.openfoodfacts.org/api/v2/product/*', () => HttpResponse.error())
    );
    const result = await fetchOffProductByBarcode('7501234567890');
    expect(result).toBeNull();
  });
});

describe('searchOffProducts', () => {
  it('maps only the hits with nutriments from the Search-a-licious response, handling array brands', async () => {
    const hitWithoutNutriments = {
      code: '1111111111111',
      product_name: 'Sin Nutrientes',
      brands: ['El Corte Inglés'],
    };
    const hitWithNutriments = {
      code: '7501234567890',
      product_name: 'Leche Entera',
      brands: ['La Serenísima', 'Otra Marca'],
      nutriments: {
        'carbohydrates_100g': 4.7,
        'energy-kcal_100g': 63,
        'fat_100g': 3.6,
        'proteins_100g': 3,
        'salt_100g': 0.13,
      },
    };
    server.use(
      http.get('https://search.openfoodfacts.org/search', () =>
        HttpResponse.json({ hits: [hitWithoutNutriments, hitWithNutriments] })
      )
    );
    const result = await searchOffProducts('leche', 20);
    expect(result).toHaveLength(1);
    expect(result[0].externalId).toBe('off:7501234567890');
    expect(result[0].brand).toBe('La Serenísima');
  });

  it('returns an empty array when Search-a-licious responds with HTTP 500', async () => {
    server.use(
      http.get('https://search.openfoodfacts.org/search', () => new HttpResponse(null, { status: 500 }))
    );
    const result = await searchOffProducts('yogur', 20);
    expect(result).toEqual([]);
  });

  it('returns an empty array on a network error', async () => {
    server.use(
      http.get('https://search.openfoodfacts.org/search', () => HttpResponse.error())
    );
    const result = await searchOffProducts('yogur', 20);
    expect(result).toEqual([]);
  });
});
