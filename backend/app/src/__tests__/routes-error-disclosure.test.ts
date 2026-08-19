import { describe, it, expect, beforeAll, afterAll, vi, type MockInstance } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * What every OTHER route says to the client when a query FAILS.
 *
 * `nutrition-error-disclosure.test.ts` pinned this for /api/nutrition and left
 * the same leak standing in seventeen handlers across five files: foods (7),
 * recipes (5), exercises (3), user (1) and body-metrics (1). Each answered a
 * caught exception with `err.message` verbatim, and that message is written for
 * whoever operates the database, not for whoever is holding the phone: a Prisma
 * or driver failure spells out the table, the index, the invocation that ran
 * and — when the connection pool is what broke — the connection string itself,
 * credentials included.
 *
 * Both halves of the answer are pinned TOGETHER, because either one alone is a
 * different bug: the client is told nothing internal, and the real cause still
 * reaches the server's log. A generic reply that also swallowed the cause would
 * trade an information leak for a blind operator.
 *
 * Two more handlers are covered here that never leaked — `PATCH /user/profile`
 * and `POST /body-metrics` already answered generically. The mutation matrix
 * reverted both to `err.message` and the entire suite stayed green: the right
 * behavior was there by luck, not by contract. Nineteen rows, seventeen fixes.
 *
 * The table is the point. Nineteen hand-written tests would drift, and the one
 * that got forgotten would be the one that keeps leaking; a row per handler
 * cannot be half-updated. The failure is forced with a spy on the delegate each
 * handler calls, which is the only way into a catch block that exists for a
 * broken database — the same technique the merge-window suite already uses.
 */
describe('error responses across every route that answered with err.message', () => {
  let userId: string;
  let authToken: string;
  const stamp = Date.now();

  /** Valid shape, deliberately nonexistent: every delegate that would look it up is mocked. */
  const UUID = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `routes.error.${stamp}@example.com`, password: 'password123', name: 'Error Tester' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const auth = (req: request.Test) => req.set('Cookie', [`auth_token=${authToken}`]);

  // The parts of a real Prisma failure that must never cross the wire. Written
  // as data so the assertion below cannot forget one of them.
  const SECRETOS = {
    credencial: 'fitness_admin:s3cr3t',
    host: '10.0.0.7:5432',
    esquema: 'schema=public',
  };

  /**
   * A stand-in shaped like what Prisma actually throws when the pool is
   * exhausted: the invocation, the connection string, and the schema object the
   * statement touched.
   */
  const falloInterno = (invocacion: string, tabla: string, indice: string) =>
    new Error(
      `Invalid \`prisma.${invocacion}()\` invocation: Timed out fetching a new connection from ` +
        `the connection pool (postgresql://${SECRETOS.credencial}@${SECRETOS.host}/fitness_prod?${SECRETOS.esquema}). ` +
        `Table "${tabla}", index "${indice}".`
    );

  /** Everything the server logged during a test, flattened into one string. */
  const registro = (log: { mock: { calls: unknown[][] } }) =>
    log.mock.calls.flat().map(String).join(' ');

  type Caso = {
    nombre: string;
    /** Prisma delegate the handler reaches first inside its own try block. */
    delegado: string;
    metodo: string;
    tabla: string;
    indice: string;
    pedir: () => request.Test;
  };

  const CASOS: Caso[] = [
    // ---- foods.routes.ts (7) ----
    {
      nombre: 'GET /api/foods',
      delegado: 'foodItem', metodo: 'findMany', tabla: 'FoodItem', indice: 'FoodItem_barcode_key',
      pedir: () => auth(request(app).get('/api/foods')),
    },
    {
      nombre: 'GET /api/foods/barcode/:code',
      delegado: 'foodItem', metodo: 'findUnique', tabla: 'FoodItem', indice: 'FoodItem_barcode_key',
      pedir: () => auth(request(app).get('/api/foods/barcode/7790895000997')),
    },
    {
      nombre: 'GET /api/foods/recent',
      delegado: 'nutritionEntry', metodo: 'findMany', tabla: 'NutritionEntry', indice: 'NutritionEntry_userId_date_idx',
      pedir: () => auth(request(app).get('/api/foods/recent')),
    },
    {
      nombre: 'GET /api/foods/favorites',
      delegado: 'foodFavorite', metodo: 'findMany', tabla: 'FoodFavorite', indice: 'FoodFavorite_userId_foodItemId_key',
      pedir: () => auth(request(app).get('/api/foods/favorites')),
    },
    {
      nombre: 'POST /api/foods/favorites',
      delegado: 'foodFavorite', metodo: 'upsert', tabla: 'FoodFavorite', indice: 'FoodFavorite_userId_foodItemId_key',
      pedir: () => auth(request(app).post('/api/foods/favorites').send({ foodItemId: UUID })),
    },
    {
      nombre: 'DELETE /api/foods/favorites/:foodItemId',
      delegado: 'foodFavorite', metodo: 'deleteMany', tabla: 'FoodFavorite', indice: 'FoodFavorite_userId_foodItemId_key',
      pedir: () => auth(request(app).delete(`/api/foods/favorites/${UUID}`)),
    },
    {
      nombre: 'POST /api/foods',
      delegado: 'foodItem', metodo: 'create', tabla: 'FoodItem', indice: 'FoodItem_barcode_key',
      pedir: () => auth(request(app).post('/api/foods').send({ name: `alimento ${stamp}` })),
    },

    // ---- recipes.routes.ts (5) ----
    {
      nombre: 'GET /api/recipes',
      delegado: 'recipe', metodo: 'findMany', tabla: 'Recipe', indice: 'Recipe_userId_idx',
      pedir: () => auth(request(app).get('/api/recipes')),
    },
    {
      // The first query this handler runs is the food-item existence check.
      nombre: 'POST /api/recipes',
      delegado: 'foodItem', metodo: 'findMany', tabla: 'FoodItem', indice: 'FoodItem_barcode_key',
      pedir: () =>
        auth(
          request(app)
            .post('/api/recipes')
            .send({ name: `receta ${stamp}`, ingredients: [{ foodItemId: UUID, grams: 100 }] })
        ),
    },
    {
      nombre: 'GET /api/recipes/:id',
      delegado: 'recipe', metodo: 'findFirst', tabla: 'Recipe', indice: 'Recipe_userId_idx',
      pedir: () => auth(request(app).get(`/api/recipes/${UUID}`)),
    },
    {
      nombre: 'PATCH /api/recipes/:id',
      delegado: 'recipe', metodo: 'findFirst', tabla: 'Recipe', indice: 'Recipe_userId_idx',
      pedir: () => auth(request(app).patch(`/api/recipes/${UUID}`).send({ name: `otro ${stamp}` })),
    },
    {
      nombre: 'DELETE /api/recipes/:id',
      delegado: 'recipe', metodo: 'findFirst', tabla: 'Recipe', indice: 'Recipe_userId_idx',
      pedir: () => auth(request(app).delete(`/api/recipes/${UUID}`)),
    },

    // ---- exercises.routes.ts (3) ----
    {
      nombre: 'GET /api/exercises',
      delegado: 'exercise', metodo: 'findMany', tabla: 'Exercise', indice: 'Exercise_name_key',
      pedir: () => request(app).get('/api/exercises'),
    },
    {
      nombre: 'GET /api/exercises/:id',
      delegado: 'exercise', metodo: 'findUnique', tabla: 'Exercise', indice: 'Exercise_name_key',
      pedir: () => request(app).get(`/api/exercises/${UUID}`),
    },
    {
      nombre: 'POST /api/exercises',
      delegado: 'exercise', metodo: 'create', tabla: 'Exercise', indice: 'Exercise_name_key',
      pedir: () => auth(request(app).post('/api/exercises').send({ name: `ejercicio ${stamp}`, category: 'PECHO' })),
    },

    // ---- user.routes.ts (2) ----
    {
      nombre: 'GET /api/user/profile',
      delegado: 'user', metodo: 'findUnique', tabla: 'User', indice: 'User_email_key',
      pedir: () => auth(request(app).get('/api/user/profile')),
    },
    {
      // Already answered generically before this change, and nothing pinned it:
      // the mutation matrix reverted it to `err.message` and the whole suite
      // stayed green. Covered here so the guarantee holds for every handler on
      // the route, not only for the ones that happened to be broken.
      nombre: 'PATCH /api/user/profile',
      delegado: 'user', metodo: 'update', tabla: 'User', indice: 'User_email_key',
      pedir: () => auth(request(app).patch('/api/user/profile').send({ name: `perfil ${stamp}` })),
    },

    // ---- body-metrics.routes.ts (2) ----
    {
      nombre: 'GET /api/body-metrics',
      delegado: 'bodyMetrics', metodo: 'findMany', tabla: 'BodyMetrics', indice: 'BodyMetrics_userId_idx',
      pedir: () => auth(request(app).get('/api/body-metrics')),
    },
    {
      // Same unpinned guarantee as PATCH /profile. The write happens inside
      // `prisma.$transaction`, and the handler's `tx` is a different client
      // than the singleton — so the failure has to be forced on the
      // transaction itself, which is also how a dead pool actually shows up.
      nombre: 'POST /api/body-metrics',
      delegado: '$root', metodo: '$transaction', tabla: 'BodyMetrics', indice: 'BodyMetrics_userId_idx',
      pedir: () => auth(request(app).post('/api/body-metrics').send({ weightKg: 80.5 })),
    },
  ];

  it.each(CASOS)('$nombre does not hand the caller the database failure behind it', async (caso) => {
    // `$root` targets the client itself ($transaction), everything else a delegate.
    const objetivo = caso.delegado === '$root' ? (prisma as any) : (prisma as any)[caso.delegado];
    const invocacion = caso.delegado === '$root' ? caso.metodo : `${caso.delegado}.${caso.metodo}`;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const espia = vi
      .spyOn(objetivo, caso.metodo)
      .mockImplementationOnce((() =>
        Promise.reject(falloInterno(invocacion, caso.tabla, caso.indice))) as never) as MockInstance;

    try {
      const res = await caso.pedir();

      expect(res.status).toBe(500);

      // Nothing internal crosses the wire...
      const cuerpo = JSON.stringify(res.body);
      for (const interno of [...Object.values(SECRETOS), invocacion, caso.tabla, caso.indice]) {
        expect(cuerpo, `leaked: ${interno}`).not.toContain(interno);
      }
      // ...and the client is still told SOMETHING. A body with no message at all
      // would pass every "does not contain" check above while leaving the client
      // unable to tell a failure from a success.
      expect(typeof res.body?.error?.message).toBe('string');
      expect(res.body.error.message.length).toBeGreaterThan(0);

      // Generic to the client, whole to the operator.
      expect(registro(log), 'the cause never reached the log').toContain(SECRETOS.host);
    } finally {
      espia.mockRestore();
      log.mockRestore();
    }
  });

  /**
   * The 400s on these routes are a different thing entirely and must NOT be
   * swept up by the fix above. `details` describes the caller's OWN input back
   * to it: it is the only way a client can find out which field is wrong, it
   * reveals nothing the caller did not already send, and it is what the
   * validation tests assert on. Generic there would be a regression, not a
   * hardening — so the distinction is pinned here, next to the leaks.
   */
  it('still tells the caller which of its own fields is wrong', async () => {
    const res = await auth(request(app).post('/api/foods/favorites').send({ foodItemId: 'no-es-un-uuid' }));

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('foodItemId');
  });
});
