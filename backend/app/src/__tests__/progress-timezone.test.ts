import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * GET /api/progress/body and GET /api/progress/nutrition, the day they
 * bucket rows into and the range they query, in the CALLER's zone.
 *
 * Template: dashboard-timezone.test.ts (real Prisma, real HTTP, frozen
 * clock, hand-seeded rows). progress-timezone-day-boundaries, spec R1/R3/R5/
 * R7/R8, design D1/D4/D5, tasks.md 1.3/1.4.
 *
 * Two fixture axes that never mix (D15):
 *  - ZONE axis: `TZ=UTC` + `?tz=BA`, every seeded row in the PAST.
 *  - CEILING axis: `TZ=UTC`, NO `?tz=`, one seeded row in the FUTURE.
 */
describe('GET /api/progress/body and /api/progress/nutrition -- timezone day boundaries', () => {
  const BA = 'America/Argentina/Buenos_Aires';
  const ORIGINAL_TZ = process.env.TZ;

  function withProcessTZ(tz: string | undefined) {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }

  function freeze(iso: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  }

  let userId: string;
  let authToken: string;
  let exerciseId: string;

  beforeAll(async () => {
    const stamp = `${Date.now()}.${Math.random()}`;
    const user = await prisma.user.create({
      data: { email: `tz.progress.${stamp}@example.com`, password: 'password123' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    const exercise = await prisma.exercise.create({
      data: { name: `TzProgress ${stamp}`, category: 'PECHO', primaryMuscles: ['pecho'] },
    });
    exerciseId = exercise.id;
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.nutritionEntry.deleteMany({ where: { userId } });
    await prisma.bodyMetrics.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  afterEach(async () => {
    vi.useRealTimers();
    withProcessTZ(ORIGINAL_TZ);
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.nutritionEntry.deleteMany({ where: { userId } });
    await prisma.bodyMetrics.deleteMany({ where: { userId } });
  });

  async function seedEntry(date: string, calories: number) {
    await prisma.nutritionEntry.create({
      data: { userId, foodName: `tz-entry-${date}`, grams: 100, mealCategory: 'Desayuno', calories, date: new Date(date) },
    });
  }

  async function seedBody(createdAt: string, weightKg: number) {
    await prisma.bodyMetrics.create({ data: { userId, weightKg, createdAt: new Date(createdAt) } });
  }

  // One working set by default -- a session with zero sets is not a session at
  // all under the `sets: { some: {} }` filter both /workouts and /dashboard use.
  async function seedSession(startedAt: string, weightKg = 100, reps = 10) {
    const session = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date(startedAt), finishedAt: new Date(startedAt) },
    });
    await prisma.workoutSet.create({
      data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg, reps },
    });
    return session;
  }

  function getNutrition(query = '') {
    return request(app).get(`/api/progress/nutrition${query}`).set('Cookie', [`auth_token=${authToken}`]);
  }

  function getBody(query = '') {
    return request(app).get(`/api/progress/body${query}`).set('Cookie', [`auth_token=${authToken}`]);
  }

  function getWorkouts(query = '') {
    return request(app).get(`/api/progress/workouts${query}`).set('Cookie', [`auth_token=${authToken}`]);
  }

  function getDashboard(query = '') {
    return request(app).get(`/api/dashboard${query}`).set('Cookie', [`auth_token=${authToken}`]);
  }

  // ---------------------------------------------------------------------
  // ZONE axis: TZ=UTC, ?tz=BA, every row in the past.
  // ---------------------------------------------------------------------

  // R1 + m8: three meals eaten the same BA-local calendar day (the last one
  // at 22:30 BA, which is 01:30 UTC the NEXT calendar day) must collapse
  // into ONE bucket keyed by the BA date, not the raw UTC date.
  describe('R1 -- nutrition bucket key follows the BA calendar day (kills m1, m8)', () => {
    async function seedMeals() {
      await seedEntry('2026-08-05T11:00:00.000Z', 400); // 08:00 BA, Aug 5th
      await seedEntry('2026-08-05T16:00:00.000Z', 700); // 13:00 BA, Aug 5th
      await seedEntry('2026-08-06T01:30:00.000Z', 900); // 22:30 BA, still Aug 5th BA
    }

    it('collapses the 3 meals into a single {2026-08-05: 2000} bucket', async () => {
      withProcessTZ('UTC');
      freeze('2026-08-06T01:35:00.000Z'); // 22:35 BA, Aug 5th -- just after the last meal
      await seedMeals();

      const res = await getNutrition(`?days=1&tz=${encodeURIComponent(BA)}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ date: '2026-08-05', calories: 2000, protein: 0 }]);
    });

    // R8 (contrast, not a mutant kill): the SAME fixture without `?tz=`
    // falls back to the process clock and correctly keeps splitting by the
    // process's own calendar day -- this is what makes the `?tz=BA` test
    // above (which kills m1: ignoring `tz` entirely) a real, non-coincidental
    // divergence, not a fixture that happens to collapse either way.
    it('R8: the same fixture WITHOUT ?tz still splits by the process (UTC) calendar day', async () => {
      withProcessTZ('UTC');
      freeze('2026-08-06T01:35:00.000Z');
      await seedMeals();

      const noTz = await getNutrition('?days=2');
      expect(noTz.status).toBe(200);
      const byDate: Record<string, number> = {};
      for (const row of noTz.body.data) byDate[row.date] = row.calories;
      expect(byDate['2026-08-05']).toBe(1100);
      expect(byDate['2026-08-06']).toBe(900);
    });
  });

  // O1: /progress/nutrition's bucket for "today" (BA) equals /api/dashboard's
  // todayCalories, same tz, same frozen clock -- both read the exact same
  // window definition (dayWindowInZone), so they cannot disagree.
  it('O1: nutrition\'s today bucket equals dashboard.todayCalories, same tz/clock', async () => {
    withProcessTZ('UTC');
    freeze('2026-08-06T01:35:00.000Z'); // 22:35 BA, Aug 5th
    await seedEntry('2026-08-05T11:00:00.000Z', 400);
    await seedEntry('2026-08-05T16:00:00.000Z', 700);
    await seedEntry('2026-08-06T01:30:00.000Z', 900);

    const nutritionRes = await getNutrition(`?days=1&tz=${encodeURIComponent(BA)}`);
    const dashboardRes = await getDashboard(`?tz=${encodeURIComponent(BA)}`);

    expect(nutritionRes.status).toBe(200);
    expect(dashboardRes.status).toBe(200);
    const todayBucket = nutritionRes.body.data.find((d: { date: string }) => d.date === '2026-08-05');
    expect(todayBucket.calories).toBe(dashboardRes.body.data.todayCalories);
    expect(Number.isInteger(dashboardRes.body.data.todayCalories)).toBe(true);
    expect(dashboardRes.body.data.todayCalories).toBe(2000);
  });

  // R3: the lower bound is calendar arithmetic in the caller's zone, not
  // `startOfDay(subDays(now, N))` on the process clock. With `now` chosen so
  // the UTC calendar date is one day ahead of the BA calendar date, the two
  // formulas disagree by exactly 21h (measured, #3459/#3468) -- a row seeded
  // AT the correct floor is included by the fix and excluded by today's code.
  describe('R3 -- range lower bound is calendar arithmetic in the caller\'s zone (21h delta)', () => {
    const NOW = '2026-08-05T01:00:00.000Z'; // 22:00 BA, Aug 4th. Buggy UTC floor is 21h later than the correct BA floor.

    it.each([
      { days: 7, floorISO: '2026-07-28T03:00:00.000Z', bucket: '2026-07-28' },
      { days: 30, floorISO: '2026-07-05T03:00:00.000Z', bucket: '2026-07-05' },
    ])('nutrition?days=$days includes a row seeded exactly at the correct BA floor', async ({ days, floorISO, bucket }) => {
      withProcessTZ('UTC');
      freeze(NOW);
      await seedEntry(floorISO, 321);

      const res = await getNutrition(`?days=${days}&tz=${encodeURIComponent(BA)}`);

      expect(res.status).toBe(200);
      const row = res.body.data.find((d: { date: string }) => d.date === bucket);
      expect(row, JSON.stringify(res.body.data)).toBeDefined();
      expect(row.calories).toBe(321);
    });

    it.each([
      { days: 7, floorISO: '2026-07-28T03:00:00.000Z' },
      { days: 30, floorISO: '2026-07-05T03:00:00.000Z' },
    ])('body?days=$days includes a row seeded exactly at the correct BA floor', async ({ days, floorISO }) => {
      withProcessTZ('UTC');
      freeze(NOW);
      await seedBody(floorISO, 70.5);

      const res = await getBody(`?days=${days}&tz=${encodeURIComponent(BA)}`);

      expect(res.status).toBe(200);
      const row = res.body.data.find((d: { date: string }) => d.date === new Date(floorISO).toISOString());
      expect(row, JSON.stringify(res.body.data)).toBeDefined();
      expect(row.weight).toBe(70.5);
    });
  });

  // R7: the shared `tz` contract (assertIanaZone via resolveIanaZone),
  // exercised once against /nutrition -- both handlers share the identical
  // validation logic (D2), so duplicating this table per endpoint would not
  // catch anything a single pass does not already catch.
  /**
   * m11: the range floor walks CALENDAR days in the caller's zone, never
   * `start - days*24h`.
   *
   * MEASURED, and it is the reason this mutant looked cheap to cut: in
   * Buenos Aires the two arithmetics agree EXACTLY -- no DST since 2009 --
   * so no test written in the app's own zone can ever kill this. Every other
   * case in this file would stay green with the mutation applied.
   *
   * Africa/Cairo's spring-forward sits inside a 120-day window, and there the
   * two floors are one hour apart -- with the RAW one EARLIER, so the mutant
   * lets in a row that does not belong:
   *   calendar = 2026-04-07T22:00:00.000Z    raw 24h steps = 2026-04-07T21:00:00.000Z
   *
   * Both edges are pinned on purpose. Asserting only that the out-of-range
   * row is absent would also pass if the handler returned nothing at all, so
   * a second row sits safely inside the window and must survive.
   *
   * The clock is frozen on the same day as every other case in this file --
   * NOT on the day near the transition. Freezing months away from the rest
   * pushes past the auth token minted in `beforeAll`, and the request 401s
   * before it ever reaches this logic: the test would then look like a
   * surviving mutant when in fact it never ran.
   *
   * Zone axis: both fixtures are in the past, process on UTC, caller on
   * Cairo -- no future row, so a missing ceiling can neither mask nor fake
   * this result.
   */
  it('m11: the range floor walks calendar days, not fixed 24h steps', async () => {
    withProcessTZ('UTC');
    freeze('2026-08-06T12:00:00.000Z');
    await seedEntry('2026-04-07T21:30:00.000Z', 111); // inside the 1h gap -- must NOT count
    await seedEntry('2026-04-08T12:00:00.000Z', 222); // safely inside the window -- must count

    const res = await getNutrition('?days=120&tz=Africa/Cairo');

    expect(res.status).toBe(200);
    expect(res.body.data.map((d: { calories: number }) => d.calories)).toEqual([222]);
  });

  describe('R7 -- tz query param contract', () => {
    it('accepts the canonical short zone name -> 200', async () => {
      const res = await getNutrition('?tz=America/Buenos_Aires');
      expect(res.status).toBe(200);
    });

    it('accepts the alias the app actually uses -> 200 (kills m16)', async () => {
      const res = await getNutrition(`?tz=${encodeURIComponent(BA)}`);
      expect(res.status).toBe(200);
    });

    it('absent tz falls back to 200 (process zone)', async () => {
      const res = await getNutrition('');
      expect(res.status).toBe(200);
    });

    it('rejects an invalid identifier without echoing it back (kills m17)', async () => {
      const res = await getNutrition('?tz=Nope/Nope');

      expect(res.status).toBe(400);
      const details = String(res.body.error.details);
      expect(details).toContain('tz');
      expect(details).not.toContain('Nope/Nope');
      expect(details).not.toMatch(/RangeError/i);
    });

    it.each(['-03:00', '+05:30'])('rejects the bare offset literal %s (kills m15)', async (offset) => {
      const res = await getNutrition(`?tz=${encodeURIComponent(offset)}`);
      expect(res.status).toBe(400);
    });

    it('rejects a duplicated tz query param (parses as an array) -> 400', async () => {
      const res = await request(app).get('/api/progress/nutrition?tz=a&tz=b').set('Cookie', [`auth_token=${authToken}`]);
      expect(res.status).toBe(400);
    });
  });

  // m2: the fallback zone must be re-read PER REQUEST, never cached at
  // module scope -- two requests, same frozen clock, same seeded rows,
  // different `process.env.TZ`, must answer differently.
  it('m2: the fallback zone is re-read per request, not frozen at import', async () => {
    freeze('2026-08-06T01:35:00.000Z'); // 22:35 BA / 01:35 UTC, Aug 5th->6th
    await seedEntry('2026-08-05T11:00:00.000Z', 400); // 08:00 BA, Aug 5th / 11:00 UTC, Aug 5th
    await seedEntry('2026-08-06T01:30:00.000Z', 900); // 22:30 BA, Aug 5th / 01:30 UTC, Aug 6th

    withProcessTZ(BA);
    const asBA = await getNutrition('?days=1');
    expect(asBA.status).toBe(200);
    const baToday = asBA.body.data.find((d: { date: string }) => d.date === '2026-08-05');
    expect(baToday?.calories).toBe(1300); // whole BA day: both entries

    withProcessTZ('UTC');
    const asUTC = await getNutrition('?days=1');
    expect(asUTC.status).toBe(200);
    const utcToday = asUTC.body.data.find((d: { date: string }) => d.date === '2026-08-05');
    expect(utcToday?.calories).toBe(400); // UTC calendar day of Aug 5th: only the first entry
  });

  // m11 (design's pre-decided cut order, applied at M-líneas time -- PR A
  // measured 491 changed lines against a ~285 estimate, over the 400-line
  // budget): CUT. The primitive it would exercise (calendar-aware floor
  // across a DST transition) is already exhaustively covered against a
  // 23-zone corpus in day-window-in-zone.test.ts; what a cut m11 test would
  // have added is only "the route calls the primitive instead of hand
  // arithmetic," verifiable by reading progress.routes.ts's `startDate` line
  // (inspection coverage, not test coverage -- documented, not pretended).

  // ---------------------------------------------------------------------
  // CEILING axis: TZ=UTC, NO ?tz=, one row in the future. Caller == process
  // zone here, so a zone bug cannot produce or hide this red (D15).
  // ---------------------------------------------------------------------

  describe('ceiling: future-dated rows never count (R5)', () => {
    // m3 was cut once to protect the line budget, then restored: the budget
    // broke anyway and the cut had bought 19 lines. "Same code shape as
    // /nutrition" is an argument about the code as written today, which is
    // exactly what a mutant is supposed to stop trusting.
    it('m3: a BodyMetrics dated the day after tomorrow never reaches /body', async () => {
      withProcessTZ('UTC');
      freeze('2026-08-06T12:00:00.000Z');
      await seedBody('2026-08-08T12:00:00.000Z', 80);

      const res = await getBody('?days=30');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('m4: a NutritionEntry dated the day after tomorrow has no bucket in /nutrition', async () => {
      withProcessTZ('UTC');
      freeze('2026-08-06T12:00:00.000Z');
      await seedEntry('2026-08-08T12:00:00.000Z', 9000); // day after tomorrow

      const res = await getNutrition('?days=30');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    // m20 / D4: the window is computed INSIDE the try, so an out-of-range
    // `days` still hits the route's own 500 shape (`{ error: { message } }`),
    // not `errorHandler`'s (`{ error: <string>, statusCode, timestamp }`).
    // The exact threshold (bisected, #3468): 100020671 does NOT throw,
    // 100020672 DOES (`RangeError: Invalid time value`). Never use 99999999
    // -- it passes vacuously (no throw at all).
    it('m20: ?days=100020672 gives the route\'s own 500 shape, not errorHandler\'s', async () => {
      withProcessTZ('UTC');
      freeze('2026-08-06T12:00:00.000Z');

      const res = await getNutrition('?days=100020672');

      expect(res.status).toBe(500);
      expect(res.body.error).toEqual({ message: 'Failed to fetch nutrition progress' });
      expect(res.body.statusCode).toBeUndefined();
      expect(res.body.timestamp).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // /progress/workouts -- week+day bucket keys and the weekly ceiling.
  // progress-timezone-day-boundaries slice 2, PR B. spec R2/R4/R5/R6,
  // design D6/D7, corrections #3468 (O2, keyed not positional, two halves).
  // ---------------------------------------------------------------------

  describe('GET /api/progress/workouts -- week boundaries in the caller\'s zone', () => {
    // R2 + m1/m8/m9/m10: session A crosses BA midnight into the NEXT UTC
    // calendar day/week; session B sits mid-day on the same BA date with no
    // such crossing. In the caller's (BA) zone both are Sunday 2026-08-02,
    // same ISO week (Monday 2026-07-27). Any of ignoring `tz` (m1), keying
    // the day off the raw UTC instant (m8), computing the week via
    // date-fns's zone-blind `startOfWeek` (m9), or starting the week on
    // Sunday (m10) scatters them into a different bucket count -- each
    // reads UTC-Aug3 for session A, so the two sessions stop sharing a
    // bucket and/or a distinct-day count.
    it('R2: collapses both sessions into the BA week/day (kills m1, m8, m9, m10)', async () => {
      withProcessTZ('UTC');
      freeze('2026-08-06T12:00:00.000Z');
      await seedSession('2026-08-03T02:00:00.000Z'); // 23:00 BA, Sun Aug 2
      await seedSession('2026-08-02T15:00:00.000Z'); // 12:00 BA, Sun Aug 2, no crossing

      const res = await getWorkouts(`?weeks=2&tz=${encodeURIComponent(BA)}`);

      expect(res.status).toBe(200);
      const bucket = res.body.data.find((d: { date: string }) => d.date === '2026-07-27');
      expect(bucket, JSON.stringify(res.body.data)).toBeDefined();
      expect(bucket.sessions).toBe(2);
      expect(bucket.activeDays).toBe(1);
    });

    // m2: the fallback zone must be re-read PER REQUEST. Same frozen clock,
    // same seeded session, only `process.env.TZ` differs -> the two
    // responses must bucket the session into different weeks.
    it('m2: the fallback zone is re-read per request, not frozen at import', async () => {
      freeze('2026-08-06T12:00:00.000Z');
      await seedSession('2026-08-03T02:00:00.000Z'); // 23:00 BA Sun Aug2 / 02:00 UTC Mon Aug3

      withProcessTZ(BA);
      const asBA = await getWorkouts('?weeks=2');
      expect(asBA.status).toBe(200);
      const baBucket = asBA.body.data.find((d: { date: string }) => d.date === '2026-07-27');
      expect(baBucket?.sessions, JSON.stringify(asBA.body.data)).toBe(1);

      withProcessTZ('UTC');
      const asUTC = await getWorkouts('?weeks=2');
      expect(asUTC.status).toBe(200);
      const utcBucket = asUTC.body.data.find((d: { date: string }) => d.date === '2026-08-03');
      expect(utcBucket?.sessions, JSON.stringify(asUTC.body.data)).toBe(1);
    });

    // m11: the range floor walks CALENDAR weeks in the caller's zone, never
    // `todayStart - weeks*7*24h`. Invisible in BA (no DST since 2009, same
    // gotcha as PR A) -- Africa/Cairo's spring-forward puts the two floors
    // 1h apart, MEASURED for `weeks=17` from this file's frozen `now`:
    // calendar-correct floor = 2026-04-08T22:00:00.000Z, raw 24h-step floor
    // (today's Cairo midnight minus 119*24h) = 2026-04-08T21:00:00.000Z, the
    // raw one EARLIER. Both edges pinned: a row in the 1h gap must NOT
    // count, a row safely inside must.
    it('m11: the range floor walks calendar weeks, not fixed 24h steps', async () => {
      withProcessTZ('UTC');
      freeze('2026-08-06T12:00:00.000Z');
      await seedSession('2026-04-08T21:30:00.000Z'); // inside the 1h gap -- must NOT count
      await seedSession('2026-04-09T12:00:00.000Z'); // safely inside the window -- must count

      const res = await getWorkouts('?weeks=17&tz=Africa/Cairo');

      expect(res.status).toBe(200);
      const totalSessions = res.body.data.reduce((sum: number, d: { sessions: number }) => sum + d.sessions, 0);
      expect(totalSessions, JSON.stringify(res.body.data)).toBe(1);
    });

    // R4/m12: the floor is a function of the LOCAL DAY, never the request's
    // time of day. Two requests on the same BA-local day (10:00 BA and
    // 22:00 BA), `weeks=1`, must return byte-identical bodies. Today's
    // `subDays(new Date(), weeks*7)` is not truncated and would answer
    // differently.
    //
    // Both freezes stay BEFORE the real wall clock (the auth token is minted
    // in `beforeAll` against the REAL clock and expires 15m later): freezing
    // forward past that expiry gives a 401 that reads as "the mutant
    // survived" when the request never reached the logic at all (PR A's own
    // incident). Both timestamps land on 2026-08-05, safely in the past.
    //
    // MEASURED: the correct (truncated) floor is 2026-07-29T03:00:00.000Z
    // for BOTH requests. A "raw ms, not truncated" floor would instead be
    // now-7d for each: 2026-07-29T13:00Z for the first request,
    // 2026-07-30T01:00Z for the second -- 12h apart. The session sits in
    // that exact 12h gap, so it is included under the correct floor (both
    // requests agree) but only under ONE of the two raw floors -- a session
    // seeded safely inside both floors would never see the mutation.
    it('R4/m12: two requests the same BA-local day return byte-identical bodies', async () => {
      await seedSession('2026-07-29T20:00:00.000Z');

      freeze('2026-08-05T13:00:00.000Z'); // 10:00 BA, Aug 5th
      const resA = await getWorkouts(`?weeks=1&tz=${encodeURIComponent(BA)}`);

      freeze('2026-08-06T01:00:00.000Z'); // 22:00 BA, still Aug 5th BA
      const resB = await getWorkouts(`?weeks=1&tz=${encodeURIComponent(BA)}`);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(resA.body.data.length).toBeGreaterThan(0);
      expect(resA.body).toEqual(resB.body);
    });

    describe('R7 -- shared tz validation, workouts call site', () => {
      it('accepts the BA alias -> 200', async () => {
        const res = await getWorkouts(`?tz=${encodeURIComponent(BA)}`);
        expect(res.status).toBe(200);
      });

      it('rejects an invalid identifier without echoing it -> 400', async () => {
        const res = await getWorkouts('?tz=Nope/Nope');
        expect(res.status).toBe(400);
        const details = String(res.body.error.details);
        expect(details).toContain('tz');
        expect(details).not.toContain('Nope/Nope');
      });
    });

    // O2 (corrections #3468, both halves mandatory): the bucket keyed by the
    // CURRENT ISO week's start, in the caller's zone, must equal dashboard's
    // weeklyWorkouts at the same instant -- and when that bucket does not
    // exist, weeklyWorkouts must be 0. Same fixture also proves D6/m13: the
    // Saturday session is LATER in the week than "now" (Wednesday), so a
    // daily ceiling would exclude it while the weekly ceiling (D6) must not.
    describe('O2 -- current-week bucket matches dashboard.weeklyWorkouts', () => {
      it('O2a + m13: bucket exists -> sessions equals dashboard.weeklyWorkouts (both 1)', async () => {
        withProcessTZ('UTC');
        freeze('2026-08-05T18:00:00.000Z'); // Wed, 15:00 BA
        await seedSession('2026-08-08T13:00:00.000Z'); // Sat, same ISO week

        const workoutsRes = await getWorkouts(`?weeks=1&tz=${encodeURIComponent(BA)}`);
        const dashboardRes = await getDashboard(`?tz=${encodeURIComponent(BA)}`);

        expect(workoutsRes.status).toBe(200);
        expect(dashboardRes.status).toBe(200);
        const bucket = workoutsRes.body.data.find((d: { date: string }) => d.date === '2026-08-03');
        expect(bucket, JSON.stringify(workoutsRes.body.data)).toBeDefined();
        expect(dashboardRes.body.data.weeklyWorkouts).toBe(1);
        expect(bucket.sessions).toBe(dashboardRes.body.data.weeklyWorkouts);
      });

      it('O2b: bucket absent -> dashboard.weeklyWorkouts is 0', async () => {
        withProcessTZ('UTC');
        freeze('2026-08-05T18:00:00.000Z'); // Wed, 15:00 BA, no sessions seeded

        const workoutsRes = await getWorkouts(`?weeks=1&tz=${encodeURIComponent(BA)}`);
        const dashboardRes = await getDashboard(`?tz=${encodeURIComponent(BA)}`);

        expect(workoutsRes.status).toBe(200);
        expect(dashboardRes.status).toBe(200);
        const bucket = workoutsRes.body.data.find((d: { date: string }) => d.date === '2026-08-03');
        expect(bucket).toBeUndefined();
        expect(dashboardRes.body.data.weeklyWorkouts).toBe(0);
      });
    });

    // ---------------------------------------------------------------------
    // CEILING axis (D15): TZ=UTC, NO ?tz=. Caller == process zone, so a
    // zone bug cannot produce or hide this red.
    // ---------------------------------------------------------------------

    // m5: a session dated NEXT week, not "later today" (D6's own oracle,
    // m13 above, proves "later this week" must count -- confusing the two
    // is exactly the error m13 exists to catch).
    it('m5: a session dated next week never reaches the current-week bucket', async () => {
      withProcessTZ('UTC');
      freeze('2026-08-05T18:00:00.000Z'); // Wed, mid current UTC week
      await seedSession('2026-08-12T15:00:00.000Z'); // next week

      const res = await getWorkouts('?weeks=1');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });
});
