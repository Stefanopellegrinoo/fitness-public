import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * What /api/nutrition says to the client when a query FAILS.
 *
 * Three handlers answered a caught exception with `err.message` verbatim. That
 * message is written for whoever operates the database, not for whoever is
 * holding the phone: a Prisma or driver failure spells out the table, the
 * column, the constraint that was violated, the invocation that ran and, when
 * the connection pool is the thing that broke, the connection string itself —
 * host, port, database and the credentials in it. Every one of those is a free
 * map of the schema handed to an unauthenticated guess, and none of them help
 * the caller do anything differently.
 *
 * The other three handlers on the same route already answer with a fixed
 * sentence. These tests pin the two halves of that answer TOGETHER, because
 * either one alone is a different bug: the client is told nothing internal, and
 * the real failure still reaches the server's log. A generic reply that also
 * swallowed the cause would trade an information leak for a blind operator.
 *
 * The failure is forced with a spy on the delegate each handler calls, which is
 * the only way into a catch block that exists for a broken database — the same
 * technique the merge-window suite already uses.
 */
describe('/api/nutrition error responses', () => {
  let userId: string;
  let authToken: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `nutri.error.${stamp}@example.com`, password: 'password123', name: 'Error Tester' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterAll(async () => {
    await prisma.nutritionGoal.deleteMany({ where: { userId } });
    await prisma.nutritionEntry.deleteMany({ where: { userId } });
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
  const falloInterno = (invocacion: string, tabla: string, restriccion: string) =>
    new Error(
      `Invalid \`prisma.${invocacion}()\` invocation: Timed out fetching a new connection from ` +
        `the connection pool (postgresql://${SECRETOS.credencial}@${SECRETOS.host}/fitness_prod?${SECRETOS.esquema}). ` +
        `Table "${tabla}", unique constraint "${restriccion}", column "kcal".`
    );

  /** Everything the server logged during a test, flattened into one string. */
  const registro = (log: { mock: { calls: unknown[][] } }) =>
    log.mock.calls.flat().map(String).join(' ');

  /**
   * The response says nothing internal, and still says something. A body with no
   * message at all would pass a "does not contain" check while leaving the
   * client unable to tell a failure from a success.
   */
  const noFiltra = (res: request.Response, ...internos: string[]) => {
    const cuerpo = JSON.stringify(res.body);
    for (const interno of [...Object.values(SECRETOS), ...internos]) {
      expect(cuerpo, `leaked: ${interno}`).not.toContain(interno);
    }
    expect(typeof res.body?.error?.message).toBe('string');
    expect(res.body.error.message.length).toBeGreaterThan(0);
  };

  it('does not hand the caller the database failure behind GET /goal', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const espia = vi
      .spyOn(prisma.nutritionGoal, 'findUnique')
      .mockImplementationOnce((() =>
        Promise.reject(falloInterno('nutritionGoal.findUnique', 'NutritionGoal', 'NutritionGoal_userId_key'))) as never);

    try {
      const res = await auth(request(app).get('/api/nutrition/goal'));

      expect(res.status).toBe(500);
      noFiltra(res, 'NutritionGoal_userId_key', 'nutritionGoal.findUnique', 'NutritionGoal');
      // Generic to the client, whole to the operator.
      expect(registro(log)).toContain(SECRETOS.host);
    } finally {
      espia.mockRestore();
      log.mockRestore();
    }
  });

  it('does not hand the caller the database failure behind POST /goal', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const espia = vi
      .spyOn(prisma.nutritionGoal, 'upsert')
      .mockImplementationOnce((() =>
        Promise.reject(falloInterno('nutritionGoal.upsert', 'NutritionGoal', 'NutritionGoal_userId_key'))) as never);

    try {
      const res = await auth(
        request(app).post('/api/nutrition/goal').send({ kcal: 2000, proteinG: 150, carbsG: 200, fatG: 65 })
      );

      expect(res.status).toBe(500);
      noFiltra(res, 'NutritionGoal_userId_key', 'nutritionGoal.upsert', 'NutritionGoal');
      expect(registro(log)).toContain(SECRETOS.host);
    } finally {
      espia.mockRestore();
      log.mockRestore();
    }
  });

  it('does not hand the caller the database failure behind the history endpoint', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const espia = vi
      .spyOn(prisma.nutritionEntry, 'findMany')
      .mockImplementationOnce((() =>
        Promise.reject(falloInterno('nutritionEntry.findMany', 'NutritionEntry', 'NutritionEntry_userId_date_idx'))) as never);

    try {
      const res = await auth(request(app).get('/api/nutrition'));

      expect(res.status).toBe(500);
      noFiltra(res, 'NutritionEntry_userId_date_idx', 'nutritionEntry.findMany', 'NutritionEntry');
      expect(registro(log)).toContain(SECRETOS.host);
    } finally {
      espia.mockRestore();
      log.mockRestore();
    }
  });

  /**
   * The 400s on this route are a different thing entirely and must NOT be swept
   * up by the fix above. `mergeFrom must not be after mergeTo` describes the
   * caller's OWN input back to it: it is the only way a client can find out
   * which of its two bounds is wrong, it reveals nothing the caller did not
   * already send, and it is what the validation tests assert on. Generic there
   * would be a regression, not a hardening — so the distinction is pinned here,
   * next to the leaks, rather than left to whoever reads the diff.
   */
  it('still tells the caller exactly which of its own bounds is wrong', async () => {
    const res = await auth(
      request(app).post('/api/nutrition').send({
        foodName: `detalle ${stamp}`,
        mealCategory: 'Desayuno',
        grams: 100,
        date: '2026-07-31T02:00:00.000Z',
        mergeFrom: '2026-07-31T02:59:59.999Z',
        mergeTo: '2026-07-30T03:00:00.000Z',
      })
    );

    expect(res.status).toBe(400);
    expect(res.body.error.details).toContain('mergeFrom must not be after mergeTo');
  });
});
