import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * Every paginated query orders by a TOTAL key -- one that ends in a column with
 * no duplicates.
 *
 * `LIMIT/OFFSET` over a non-unique `ORDER BY` has no defined result. Postgres
 * may return tied rows in any order, and it is free to pick a DIFFERENT order
 * per query, so a row can land on page 1 and page 2 while another lands on
 * neither. That is a row the user silently never sees.
 *
 * WHY THIS ASSERTS THE PROPERTY AND NOT THE SYMPTOM -- measured, because the
 * obvious test is a trap. Seeding tied rows and counting duplicates across
 * pages gives an oracle that flips on the query PLAN, not on the code:
 *
 *   recipes, 60 tied rows, pages of 7      -> 3 duplicated, 3 missing
 *   foods `contains`, 3000 tied rows       -> 4 duplicated
 *   foods `contains`, 100 tied rows        -> 4 duplicated
 *   foods `contains`, 200/400/800/1600     -> 0 duplicated
 *   foods exact match, 60 and 3000 rows    -> 0 duplicated
 *
 * Not monotonic in row count: the defect surfaces when the planner switches
 * strategy, which depends on table statistics and autovacuum timing, not on
 * anything the test controls. A duplicate-counting assertion would therefore go
 * green on broken code and red on fixed code, at random. It would be a coin
 * flip wearing a test's name.
 *
 * So the middleware below reads the `orderBy` the route actually sent to
 * Prisma, and the assertion is the invariant itself: the last sort key is
 * unique. That is deterministic, and it holds for every plan Postgres could
 * ever choose.
 */

// `id` is `@id @default(uuid())` on every model reached here, so it is the
// tiebreaker available everywhere. Any other column with a unique constraint
// would do; none of these models has one that is also stable.
const UNIQUE_KEY = 'id';

/**
 * WHAT THIS FILE DOES NOT COVER -- measured, not assumed.
 *
 * 1. `AgentService.chatStream` reads the user's latest weigh-in with
 *    `bodyMetrics: { orderBy, take: 1 }` nested inside a `findUnique`, and
 *    states it back to the user as fact. Dropping its tiebreaker leaves this
 *    file GREEN: the hook filters on `findMany`, and a nested `take` never
 *    reaches `params.args.take` anyway. Killing it needs the OpenAI SDK mocked
 *    (the client is constructed at module load from the env key) plus a hook
 *    that walks `include` trees -- scaffolding out of proportion to a one-line
 *    guard in a file that has no tests at all. Named here so the gap is a known
 *    one rather than a silent one.
 *
 * 2. The DIRECTION of the tiebreaker. `[{ date: 'desc' }, { id: 'asc' }]`
 *    survives, and should: it is still a total order and still deterministic,
 *    it just picks the other row of a tie. Which one wins is a product choice,
 *    not a correctness property, and this file asserts the property.
 */

interface Captured {
  model: string | undefined;
  orderBy: unknown;
  skip: number | undefined;
  take: number | undefined;
}

const captured: Captured[] = [];
let capturing = false;

/**
 * `$use` is deprecated in Prisma 5 but is the only hook that mutates the
 * SHARED client -- `$extends` returns a new one, which the routes under test
 * would never see. It is installed once at module load and gated on
 * `capturing`, so its cost outside this file is one boolean check per query.
 * Vitest runs each test file in its own worker, so no other file shares this
 * client instance and nothing leaks across the suite.
 */
(prisma as any).$use(async (params: any, next: any) => {
  if (capturing && params.action === 'findMany') {
    const { skip, take, orderBy } = params.args ?? {};
    // `orderBy` alone counts, not just `skip`/`take`. A list returned WHOLE
    // loses no rows to a bad sort key, but it still reshuffles between
    // identical requests when the key ties -- `/foods/favorites` is exactly
    // that shape. Widening this was measured against the seven endpoints that
    // predate it: all seven stayed green, so it adds coverage without
    // asserting on queries that never had the property.
    if (skip !== undefined || take !== undefined || orderBy !== undefined) {
      captured.push({ model: params.model, orderBy, skip, take });
    }
  }
  return next(params);
});

/**
 * The last sort key of an `orderBy`, whether it is an object or an array.
 *
 * MUTATION NOTE: replacing the inner `keys[keys.length - 1]` with `keys[0]`
 * leaves this file green, and is an EQUIVALENT mutant today -- every call site
 * writes single-key objects (`[{ name: 'asc' }, { id: 'asc' }]`), so first and
 * last key coincide. The index still earns its line because Prisma also accepts
 * a multi-key object (`{ name: 'asc', id: 'asc' }`), where the trailing key is
 * the tiebreaker and `keys[0]` would read the wrong one. Both array mutants DO
 * die (taking `orderBy[0]` instead of the last clause: 7 failed).
 */
function lastSortKey(orderBy: unknown): string | undefined {
  const clause = Array.isArray(orderBy) ? orderBy[orderBy.length - 1] : orderBy;
  if (!clause || typeof clause !== 'object') return undefined;
  const keys = Object.keys(clause);
  return keys[keys.length - 1];
}

describe('every paginated query orders by a total key', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    const stamp = `${Date.now()}.${Math.random()}`;
    const user = await prisma.user.create({
      data: { email: `pageorder.${stamp}@example.com`, password: 'password123' },
    });
    userId = user.id;
    token = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterAll(async () => {
    capturing = false;
    await prisma.user.delete({ where: { id: userId } });
  });

  /**
   * `/foods` is requested WITHOUT `q`. With one, the route calls OpenFoodFacts
   * before the query when `offset === 0` -- a network round trip this test has
   * no business making. The `orderBy` under test is the same on both paths.
   */
  const ENDPOINTS: Array<[string, string]> = [
    ['foods', '/api/foods?limit=2&offset=0'],
    ['recipes', '/api/recipes?limit=2&offset=0'],
    ['body metrics', '/api/body-metrics?limit=2&offset=0'],
    ['workout sessions', '/api/workouts/sessions?limit=2&offset=0'],
    ['routines', '/api/routines?limit=2&offset=0'],
    ['exercises', '/api/exercises?limit=2&offset=0'],
    ['nutrition entries', '/api/nutrition?limit=2&offset=0'],
    ['recent foods', '/api/foods/recent?limit=2'],
    ['favorite foods', '/api/foods/favorites'],
    // A UUID that matches no exercise: the route still issues the findMany
    // under test, and seeding a real training history would only add fixture
    // to assert nothing extra on.
    ['exercise progression', `/api/stats/exercises/${randomUUID()}/progression?limit=2`],
  ];

  it.each(ENDPOINTS)('%s paginates on a unique last sort key', async (_label, url) => {
    captured.length = 0;
    capturing = true;
    const res = await request(app).get(url).set('Cookie', [`auth_token=${token}`]);
    capturing = false;

    // A route that errored proves nothing about its ordering.
    expect(res.status, `${url} -> ${res.status} ${JSON.stringify(res.body)}`).toBe(200);

    // Guard: an endpoint that stopped paginating would pass every assertion
    // below by having nothing to assert on.
    expect(captured.length, `${url} issued no paginated findMany`).toBeGreaterThan(0);

    for (const q of captured) {
      expect(
        lastSortKey(q.orderBy),
        `${q.model}.findMany paginates on ${JSON.stringify(q.orderBy)}, whose last key is not unique -- ` +
          `LIMIT/OFFSET over it can repeat and skip rows`
      ).toBe(UNIQUE_KEY);
    }
  });
});
