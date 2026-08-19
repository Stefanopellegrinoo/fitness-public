import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * The `?tz=` contract, asserted ACROSS endpoints rather than within one.
 *
 * Seven routes accept `tz`. Each one's own suite proves that endpoint behaves;
 * none of them prove the seven behave THE SAME, and that is a property of the
 * API as a whole -- the kind that drifts a route at a time: one validates
 * before its try block and another after, one returns `details` as a string
 * and another as an object, one echoes the rejected value.
 *
 * The drift is not hypothetical, it is designed in. Design D2 chose to
 * REPEAT the `try/catch -> 400` block in every route instead of extracting
 * it, because what varies per router is the HTTP response and the error
 * context. That was the right call, and it leaves seven copies whose agreement
 * rests on discipline. This file is what replaces the discipline.
 *
 * The rejection cases compare the seven bodies to EACH OTHER, byte for byte,
 * not merely that each is "some 400" -- seven different 400s would satisfy
 * every per-endpoint test in the repo and fail only here.
 *
 * The seventh joined in slice 4: `/api/routines/:id/next-day` resolves a
 * WEEKDAY rather than a window, but it reads `tz` through the same primitive
 * and therefore owes the same answers. It is the only parameterised path here,
 * which is why the list is built per run instead of being a module constant.
 */
const STATIC_ENDPOINTS = [
  '/api/dashboard',
  '/api/dashboard/stats/volume',
  '/api/progress/body',
  '/api/progress/nutrition',
  '/api/progress/workouts',
  '/api/stats/weekly-volume',
];

describe('every tz-accepting endpoint answers the same way', () => {
  let token: string;
  let userId: string;
  let ENDPOINTS: string[];

  beforeAll(async () => {
    const stamp = `${Date.now()}.${Math.random()}`;
    const user = await prisma.user.create({
      data: { email: `tz.uniform.${stamp}@example.com`, password: 'password123' },
    });
    userId = user.id;
    token = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    // Owned by this user: the route answers 404 before it ever looks at `tz`,
    // so a foreign routine would make every case here a 404 and prove nothing.
    const routine = await prisma.routine.create({ data: { name: 'TZ Uniform', userId } });
    ENDPOINTS = [...STATIC_ENDPOINTS, `/api/routines/${routine.id}/next-day`];
  });

  afterAll(async () => {
    await prisma.routine.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const get = (path: string, query: string) =>
    request(app).get(`${path}${query}`).set('Cookie', [`auth_token=${token}`]);

  const ACCEPTED: Array<[string, string]> = [
    ['canonical', '?tz=UTC'],
    ['the alias supportedValuesOf rejects', '?tz=America%2FArgentina%2FBuenos_Aires'],
    ['absent (falls back to the process zone)', ''],
    ['a fixed-offset zone (shape-legal, documented)', '?tz=Etc%2FGMT%2B12'],
    // MEASURED: express 5's default query parser is `simple` (node's
    // `querystring`), so `tz[x]=UTC` produces the literal key `"tz[x]"` and
    // leaves `req.query.tz` undefined. This is therefore the SAME case as an
    // absent param, not an object reaching the validator -- 200 is correct.
    // (`assertIanaZone`'s `typeof !== 'string'` guard still earns its keep on
    // `?tz=a&tz=b`, which the simple parser DOES turn into an array, and would
    // cover objects if the parser were ever switched to `extended`.)
    ['a bracket-shaped param (parses as a differently-named key)', '?tz[x]=UTC'],
  ];

  const REJECTED: Array<[string, string]> = [
    ['an unknown identifier', '?tz=Nope%2FNope'],
    ['a bare offset literal', '?tz=-03%3A00'],
    ['a duplicated param (parses as an array)', '?tz=UTC&tz=America%2FLima'],
    ['an empty value', '?tz='],
    ['a prototype-shaped name', '?tz=__proto__'],
  ];

  it.each(ACCEPTED)('all seven accept %s', async (_label, query) => {
    const results = await Promise.all(ENDPOINTS.map((e) => get(e, query)));
    const statuses = Object.fromEntries(ENDPOINTS.map((e, i) => [e, results[i].status]));
    expect(statuses, JSON.stringify(statuses, null, 2)).toEqual(
      Object.fromEntries(ENDPOINTS.map((e) => [e, 200]))
    );
  });

  it.each(REJECTED)('all seven reject %s with one identical 400', async (_label, query) => {
    const results = await Promise.all(ENDPOINTS.map((e) => get(e, query)));

    const statuses = Object.fromEntries(ENDPOINTS.map((e, i) => [e, results[i].status]));
    expect(statuses, JSON.stringify(statuses, null, 2)).toEqual(
      Object.fromEntries(ENDPOINTS.map((e) => [e, 400]))
    );

    // Same body, byte for byte -- not merely "each is some 400".
    const bodies = results.map((r) => r.body);
    for (const body of bodies) expect(body).toEqual(bodies[0]);

    // And that shared body discloses nothing.
    const details = String(bodies[0].error.details);
    expect(typeof bodies[0].error.details).toBe('string');
    expect(details).toContain('tz');
    expect(details).not.toMatch(/RangeError/i);
    for (const leak of ['Nope', '-03:00', '__proto__', 'Lima']) {
      expect(details).not.toContain(leak);
    }
  });

  it('a valid tz never changes the SHAPE of a success response', async () => {
    const withTz = await Promise.all(ENDPOINTS.map((e) => get(e, '?tz=UTC')));
    const without = await Promise.all(ENDPOINTS.map((e) => get(e, '')));

    ENDPOINTS.forEach((endpoint, i) => {
      expect(Object.keys(withTz[i].body), endpoint).toEqual(Object.keys(without[i].body));
    });
  });
});
