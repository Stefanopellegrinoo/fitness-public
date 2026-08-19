import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * GET /api/dashboard, the day and week it reports "today"/"this week" for.
 *
 * Real database, real HTTP layer (pattern of `empty-sessions-excluded.test.ts`),
 * a frozen clock and hand-seeded rows -- the only layer where a mock cannot
 * lie about whether the window that was COMPUTED is the window that actually
 * reached Prisma (design's own risk note: an earlier PR in this repo shipped
 * a test that passed with `orderBy` deleted outright).
 *
 * user-timezone-day-boundaries, spec R1/R3/R4/R5/R6, tasks.md 2.2.
 */
describe('GET /api/dashboard -- user timezone day/week boundaries', () => {
  const BA = 'America/Argentina/Buenos_Aires';
  const ORIGINAL_TZ = process.env.TZ;

  function withProcessTZ(tz: string | undefined) {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }

  let exerciseId: string;
  let userId: string;
  let authToken: string;

  beforeAll(async () => {
    const exercise = await prisma.exercise.create({
      data: { name: `TZDashboard ${Date.now()}`, category: 'PECHO', primaryMuscles: ['pecho'] },
    });
    exerciseId = exercise.id;

    const stamp = `${Date.now()}.${Math.random()}`;
    const user = await prisma.user.create({
      data: { email: `tz.dashboard.${stamp}@example.com`, password: 'password123' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterAll(async () => {
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.nutritionEntry.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  afterEach(async () => {
    vi.useRealTimers();
    withProcessTZ(ORIGINAL_TZ);
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.nutritionEntry.deleteMany({ where: { userId } });
  });

  // Only `Date` is faked. These tests drive REAL Prisma writes and REAL
  // supertest requests inside the frozen window, and vitest's default fakes
  // setTimeout/setInterval/setImmediate too -- so a connection-pool acquire
  // timeout or an HTTP retry backoff would never fire, and the test would
  // hang to the suite timeout instead of failing with something readable.
  // Green today only because `beforeAll` leaves the pool warm.
  function freeze(iso: string) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  }

  async function seedEntry(date: string, calories: number) {
    await prisma.nutritionEntry.create({
      data: { userId, foodName: `tz-entry-${date}`, grams: 100, mealCategory: 'Desayuno', calories, date: new Date(date) },
    });
  }

  async function seedWorkout(startedAt: string) {
    const session = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date(startedAt), finishedAt: new Date(startedAt) },
    });
    await prisma.workoutSet.create({
      data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 60, reps: 8, setType: 'WORKING' },
    });
  }

  function getDashboard(query = '') {
    return request(app).get(`/api/dashboard${query}`).set('Cookie', [`auth_token=${authToken}`]);
  }

  // R1 + M3: the day boundary is the CALLER's zone, not the process clock's.
  // Both scenarios below name the same Buenos Aires calendar day (June 5th) at
  // two different UTC clock times -- so a correct implementation answers the
  // SAME total for both, and a broken one (M3: ignores `tz`, uses the process
  // clock) does not, because it measures a UTC calendar day instead.
  //
  // `process.env.TZ` is forced to 'UTC' for the duration of each of these two
  // tests specifically so the divergence is real regardless of which zone this
  // machine happens to boot with (which, on this sandbox, already IS Buenos
  // Aires -- so without forcing UTC, M3 would coincidentally still pass here).
  describe('R1 -- the day boundary follows ?tz, not the process clock (kills M3)', () => {
    // BA day of June 5th: [2025-06-05T03:00:00.000Z, 2025-06-06T03:00:00.000Z).
    // One entry just after the window opens, one just before it closes --
    // 1500kcal total, split across two different UTC calendar days.
    async function seedDay5() {
      await seedEntry('2025-06-05T04:00:00.000Z', 500); // 01:00 BA, June 5th
      await seedEntry('2025-06-06T02:00:00.000Z', 1000); // 23:00 BA, June 5th
    }

    it('15:00 BA, no future entries -> 1500', async () => {
      withProcessTZ('UTC');
      freeze('2025-06-05T18:00:00.000Z'); // 15:00 BA
      await seedDay5();

      const res = await getDashboard(`?tz=${encodeURIComponent(BA)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.todayCalories).toBe(1500);
    });

    it('22:00 BA, no future entries -> 1500', async () => {
      withProcessTZ('UTC');
      freeze('2025-06-06T01:00:00.000Z'); // 22:00 BA, same BA calendar day as above
      await seedDay5();

      const res = await getDashboard(`?tz=${encodeURIComponent(BA)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.todayCalories).toBe(1500);
    });
  });

  // R5 (day side) + M1: dropping `lt` from the nutrition query lets a
  // future-dated entry inflate today's total.
  it('R5: a future-dated nutrition entry never counts toward today (kills M1)', async () => {
    withProcessTZ('UTC');
    freeze('2025-06-05T18:00:00.000Z'); // 15:00 BA, June 5th
    await seedEntry('2025-06-05T04:00:00.000Z', 500); // 01:00 BA, June 5th (today)
    await seedEntry('2025-06-06T02:00:00.000Z', 1000); // 23:00 BA, June 5th (today)
    await seedEntry('2025-06-07T04:00:00.000Z', 9000); // June 7th BA (future)

    const res = await getDashboard(`?tz=${encodeURIComponent(BA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.todayCalories).toBe(1500);
  });

  // R5 (week side) + M2/M8: the week window is Monday-first AND capped above.
  describe('R5 -- the week window is Monday-first and capped above', () => {
    // "now" = Wednesday June 4th 15:00 BA. BA week: [Mon June 2 03:00Z, Mon June 9 03:00Z).
    const NOW_WED = '2025-06-04T18:00:00.000Z';

    it('a workout dated for next week\'s Sunday never counts this week (kills M2)', async () => {
      withProcessTZ('UTC');
      freeze(NOW_WED);
      await seedWorkout('2025-06-16T01:00:00.000Z'); // Sunday 22:00 BA, week of June 9-15

      const res = await getDashboard(`?tz=${encodeURIComponent(BA)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.weeklyWorkouts).toBe(0);
      expect(res.body.data.activeMinutes).toBe(0);
    });

    // A Sunday-first week (M8) would start this window one day EARLY, at
    // Sunday June 1st 00:00 BA -- so a session logged the evening before this
    // week's real Monday would wrongly survive under that mutant.
    it('a workout dated the evening before this week\'s Monday never counts (kills M8)', async () => {
      withProcessTZ('UTC');
      freeze(NOW_WED);
      await seedWorkout('2025-06-02T02:00:00.000Z'); // Sunday 23:00 BA, June 1st -- one hour before the real Monday boundary

      const res = await getDashboard(`?tz=${encodeURIComponent(BA)}`);

      expect(res.status).toBe(200);
      expect(res.body.data.weeklyWorkouts).toBe(0);
      expect(res.body.data.activeMinutes).toBe(0);
    });
  });

  // R3: `tz` is validated by an Intl constructor probe plus an IANA-shape
  // filter, never against `Intl.supportedValuesOf`, and never accepting the
  // bare `±HH:MM` offset syntax. Note the shape filter rejects that SYNTAX,
  // not fixed offsets as a class -- MEASURED, `Etc/GMT+12` still passes.
  describe('R3 -- tz validation', () => {
    it('accepts the canonical short zone name -> 200', async () => {
      const res = await getDashboard('?tz=America/Buenos_Aires');
      expect(res.status).toBe(200);
    });

    // MEASURED (backend/timezone-validation): `Intl.supportedValuesOf('timeZone')`
    // returns only the CANONICAL short name and would reject this long alias,
    // which is the app's real user zone and every other test file's fixture.
    it('accepts the alias the app actually uses -> 200 (kills M6)', async () => {
      const res = await getDashboard(`?tz=${encodeURIComponent(BA)}`);
      expect(res.status).toBe(200);
    });

    // M14: the 400 names the field and gives an example, and echoes neither
    // the raw value the caller sent nor the underlying RangeError's message.
    it('rejects an invalid identifier without echoing it back (kills M14)', async () => {
      const res = await getDashboard('?tz=Nope/Nope');

      expect(res.status).toBe(400);
      const details = String(res.body.error.details);
      expect(details).toContain('tz');
      expect(details).not.toContain('Nope/Nope');
      expect(details).not.toMatch(/RangeError/i);
    });

    // MEASURED (backend/timezone-validation): `Intl.DateTimeFormat` alone
    // ACCEPTS fixed offsets. A probe-only check (M7, skipping the IANA-shape
    // filter) would let these through; they have no DST and would silently
    // miscompute boundaries for anyone in a zone that observes one.
    it.each(['-03:00', '+05:30'])('rejects the bare offset literal %s (kills M7)', async (offset) => {
      const res = await getDashboard(`?tz=${encodeURIComponent(offset)}`);
      expect(res.status).toBe(400);
    });

    // Express parses a duplicated query key as an array, not a string.
    it('rejects a duplicated tz query param -> 400', async () => {
      const res = await request(app).get('/api/dashboard?tz=a&tz=b').set('Cookie', [`auth_token=${authToken}`]);
      expect(res.status).toBe(400);
    });
  });

  // R4 + M10: absent `tz` falls back to the server's own zone, resolved FRESH
  // on every request -- never cached at module load. Two sequential requests
  // under two different `process.env.TZ` values, same frozen clock, same
  // seeded data: a module-scope fallback (M10) would answer identically both
  // times; the correct per-request read answers differently.
  it('R4/M10: the fallback zone is re-read per request, not frozen at import', async () => {
    freeze('2025-06-05T18:00:00.000Z'); // 15:00 BA / 18:00 UTC, June 5th
    await seedEntry('2025-06-05T04:00:00.000Z', 500); // 01:00 BA, June 5th
    await seedEntry('2025-06-06T02:00:00.000Z', 1000); // 23:00 BA, June 5th

    withProcessTZ(BA);
    const asBA = await getDashboard();
    expect(asBA.status).toBe(200);
    expect(asBA.body.data.todayCalories).toBe(1500); // whole BA day: both entries

    withProcessTZ('UTC');
    const asUTC = await getDashboard();
    expect(asUTC.status).toBe(200);
    expect(asUTC.body.data.todayCalories).toBe(500); // UTC calendar day of June 5th: only the first entry
  });

  // R6: the same window definition backs both /api/dashboard and
  // /api/nutrition, so the two backend endpoints a fixed frontend would read
  // from necessarily agree -- this is the backend-side guarantee the
  // frontend's "one number for today" fix (R6, PR2b) depends on.
  it('R6: dashboard.todayCalories matches the sum of /api/nutrition over the same BA day window', async () => {
    withProcessTZ('UTC');
    freeze('2025-06-05T18:00:00.000Z'); // 15:00 BA
    await seedEntry('2025-06-05T04:00:00.000Z', 500);
    await seedEntry('2025-06-06T02:00:00.000Z', 1000);
    await seedEntry('2025-06-07T04:00:00.000Z', 9000); // outside the BA day, must not leak into either side

    const dashboardRes = await getDashboard(`?tz=${encodeURIComponent(BA)}`);
    expect(dashboardRes.status).toBe(200);

    const nutritionRes = await request(app)
      .get('/api/nutrition?from=2025-06-05T03:00:00.000Z&to=2025-06-06T03:00:00.000Z')
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(nutritionRes.status).toBe(200);
    const nutritionTotal = (nutritionRes.body.data as Array<{ calories: number }>).reduce(
      (sum, entry) => sum + entry.calories,
      0
    );

    expect(dashboardRes.body.data.todayCalories).toBe(nutritionTotal);
    expect(nutritionTotal).toBe(1500);
  });
});
