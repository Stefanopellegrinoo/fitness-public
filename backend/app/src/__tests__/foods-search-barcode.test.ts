import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import request from 'supertest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

const server = setupServer();

describe('/api/foods search + barcode', () => {
  let userId: string;
  let authToken: string;
  const stamp = Date.now();
  const createdFoodIds: string[] = [];
  const createdExternalIds: string[] = [];

  beforeAll(async () => {
    // 'bypass' (not 'error'): msw's node interceptor patches all outgoing HTTP,
    // including supertest's own request to the local Express server under test
    // (a real socket to 127.0.0.1) — 'error' would misfire on that local traffic.
    server.listen({ onUnhandledRequest: 'bypass' });
    const user = await prisma.user.create({
      data: { email: `foods.search.${stamp}@example.com`, password: 'password123', name: 'Foods Search Tester' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterEach(() => server.resetHandlers());

  afterAll(async () => {
    server.close();
    if (createdExternalIds.length) {
      await prisma.foodItem.deleteMany({ where: { externalId: { in: createdExternalIds } } });
    }
    if (createdFoodIds.length) {
      await prisma.foodItem.deleteMany({ where: { id: { in: createdFoodIds } } });
    }
    await prisma.user.delete({ where: { id: userId } });
  });

  it('barcode LOCAL hit returns the cached food without calling OFF', async () => {
    const barcode = `LOCAL${stamp}`;
    const local = await prisma.foodItem.create({
      data: {
        name: `Local Barcode Food ${stamp}`,
        barcode,
        source: 'MANUAL',
        caloriesPer100g: 100,
        proteinPer100g: 5,
        carbsPer100g: 10,
        fatPer100g: 2,
      },
    });
    createdFoodIds.push(local.id);

    // Spy handler for the OFF host: if the route wrongly fell through to OFF
    // on a local hit, this flips to true and the assertion below catches it.
    let offCalled = false;
    server.use(
      http.get('https://world.openfoodfacts.org/api/v2/product/*', () => {
        offCalled = true;
        return HttpResponse.json({ status: 0 });
      })
    );

    const res = await request(app)
      .get(`/api/foods/barcode/${barcode}`)
      .set('Cookie', [`auth_token=${authToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(local.id);
    expect(offCalled).toBe(false);
  });

  it('barcode MISS fetches from OFF and caches it as OPEN_FOOD_FACTS', async () => {
    const barcode = `MISS${stamp}`;
    createdExternalIds.push(`off:${barcode}`);
    server.use(
      http.get('https://world.openfoodfacts.org/api/v2/product/*', () =>
        HttpResponse.json({
          status: 1,
          product: {
            code: barcode,
            product_name: 'Producto OFF de Prueba',
            brands: 'MarcaTest',
            nutriments: {
              'energy-kcal_100g': 150,
              'proteins_100g': 10,
              'carbohydrates_100g': 20,
              'fat_100g': 5,
            },
          },
        })
      )
    );

    const res = await request(app)
      .get(`/api/foods/barcode/${barcode}`)
      .set('Cookie', [`auth_token=${authToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('OPEN_FOOD_FACTS');

    const cached = await prisma.foodItem.findUnique({ where: { externalId: `off:${barcode}` } });
    expect(cached).not.toBeNull();
    expect(cached?.source).toBe('OPEN_FOOD_FACTS');
  });

  it('barcode MISS with OFF status 0 returns 404', async () => {
    const barcode = `NOPE${stamp}`;
    server.use(
      http.get('https://world.openfoodfacts.org/api/v2/product/*', () => HttpResponse.json({ status: 0 }))
    );
    const res = await request(app)
      .get(`/api/foods/barcode/${barcode}`)
      .set('Cookie', [`auth_token=${authToken}`]);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('Alimento no encontrado para ese código de barras');
  });

  it('search ranks a GENERIC food before an OFF-branded item', async () => {
    const q = `zzrank${stamp}`;
    const generic = await prisma.foodItem.create({
      data: {
        name: `Snack ${q} Casero`,
        source: 'GENERIC',
        externalId: `generic:rank-${stamp}`,
        caloriesPer100g: 200,
        proteinPer100g: 8,
        carbsPer100g: 20,
        fatPer100g: 5,
      },
    });
    const offItem = await prisma.foodItem.create({
      data: {
        name: `Snack ${q} Marca`,
        brand: 'BrandX',
        source: 'OPEN_FOOD_FACTS',
        externalId: `off:rank-${stamp}`,
        barcode: `OFFB${stamp}`,
        caloriesPer100g: 210,
        proteinPer100g: 7,
        carbsPer100g: 22,
        fatPer100g: 6,
      },
    });
    createdFoodIds.push(generic.id, offItem.id);

    // localCount (2) < OFF_AUGMENT_THRESHOLD (10) → the route calls OFF search;
    // return no hits so nothing is augmented and the ranking assertion stays deterministic.
    server.use(
      http.get('https://search.openfoodfacts.org/search', () => HttpResponse.json({ hits: [] }))
    );

    const res = await request(app)
      .get(`/api/foods?q=${q}`)
      .set('Cookie', [`auth_token=${authToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].id).toBe(generic.id);
    expect(res.body.data[0].source).toBe('GENERIC');
  });
});
