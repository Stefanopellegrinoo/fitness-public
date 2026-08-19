import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

/**
 * getWeeklyVolume / GET /api/stats/weekly-volume and GET /api/dashboard/stats/volume,
 * the week they bucket sets/sessions into and the range they query, in the CALLER's zone.
 *
 * Template: progress-timezone.test.ts / dashboard-timezone.test.ts (real Prisma, real HTTP,
 * frozen clock, hand-seeded rows). progress-timezone-day-boundaries, spec R9-R12, design
 * D8-D13, corrections #3468 (D3/D4 measurements). PR C, tasks.md 3.1-3.6.
 *
 * Fixture axes that never mix (D15), plus the endpoint-specific FORM axis already used in
 * PR B for m12/m13:
 *  - ZONE axis: `TZ=UTC` + `?tz=BA`, every seeded row in the PAST.
 *  - CEILING axis: `TZ=UTC`, NO `?tz=`, one seeded row in the FUTURE.
 *  - FORM axis: frozen clock, BA fixtures, tests the SHAPE of the range (Monday alignment,
 *    current-vs-previous classification) rather than the zone conversion itself.
 */
describe('getWeeklyVolume / GET /api/stats/weekly-volume and GET /api/dashboard/stats/volume -- timezone day boundaries', () => {
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
      data: { email: `tz.volume.${stamp}@example.com`, password: 'password123' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    const exercise = await prisma.exercise.create({
      data: { name: `TzVolume ${stamp}`, category: 'PECHO', primaryMuscles: ['pecho'] },
    });
    exerciseId = exercise.id;
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  afterEach(async () => {
    vi.useRealTimers();
    withProcessTZ(ORIGINAL_TZ);
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
  });

  // One WORKING set, explicit createdAt -- getWeeklyVolume buckets by set.createdAt, not
  // session.startedAt (D12/R10, conserved unchanged in this slice).
  async function seedSet(createdAt: string, weightKg = 80, reps = 8) {
    const session = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date(createdAt), finishedAt: new Date(createdAt) },
    });
    await prisma.workoutSet.create({
      data: {
        sessionId: session.id, exerciseId, setNumber: 1, weightKg, reps, setType: 'WORKING',
        createdAt: new Date(createdAt),
      },
    });
  }

  function getWeeklyVolumeRoute(query = '') {
    return request(app).get(`/api/stats/weekly-volume${query}`).set('Cookie', [`auth_token=${authToken}`]);
  }

  function getVolumeStatsRoute(query = '') {
    return request(app).get(`/api/dashboard/stats/volume${query}`).set('Cookie', [`auth_token=${authToken}`]);
  }

  function getDashboard(query = '') {
    return request(app).get(`/api/dashboard${query}`).set('Cookie', [`auth_token=${authToken}`]);
  }

  // ---------------------------------------------------------------------
  // ZONE axis: TZ=UTC, ?tz=BA, every row in the past.
  // ---------------------------------------------------------------------

  // R9 + m1/m8/m9/m10: a set logged Sunday 23:00 BA (crossing into Monday UTC) and a set
  // logged Sunday noon BA (no crossing) are the SAME BA week (Monday 2026-07-27). Ignoring
  // `tz` (m1), formatting the raw UTC instant (m8), a zone-blind `startOfWeek` (m9), or a
  // Sunday-first week (m10, shared primitive) scatters them into different buckets.
  describe('R9 -- weekly-volume bucket key follows the BA calendar week (kills m1, m8, m9, m10)', () => {
    it('collapses both sets into the BA week bucket, hardSets summed', async () => {
      withProcessTZ('UTC');
      freeze('2026-08-06T12:00:00.000Z'); // Thu, within the week starting 2026-08-03
      await seedSet('2026-08-03T02:00:00.000Z'); // 23:00 BA, Sun Aug2
      await seedSet('2026-08-02T15:00:00.000Z'); // 12:00 BA, Sun Aug2, no crossing

      const res = await getWeeklyVolumeRoute(`?weeks=2&tz=${encodeURIComponent(BA)}`);

      expect(res.status).toBe(200);
      const bucket = res.body.data.find((w: { week: string }) => w.week === '2026-07-27');
      expect(bucket, JSON.stringify(res.body.data)).toBeDefined();
      expect(bucket.muscles['pecho'].hardSets).toBe(2);
    });
  });

  // m2: the fallback zone must be re-read PER REQUEST, never cached at module scope. Same
  // shared primitive already covered by PR A/B's own m2 tests; this documents the call site.
  it('m2: the fallback zone is re-read per request, not frozen at import', async () => {
    freeze('2026-08-06T12:00:00.000Z');
    await seedSet('2026-08-03T02:00:00.000Z'); // 23:00 BA Sun Aug2 / 02:00 UTC Mon Aug3

    withProcessTZ(BA);
    const asBA = await getWeeklyVolumeRoute('?weeks=2');
    expect(asBA.status).toBe(200);
    const baBucket = asBA.body.data.find((w: { week: string }) => w.week === '2026-07-27');
    expect(baBucket?.muscles['pecho'].hardSets, JSON.stringify(asBA.body.data)).toBe(1);

    withProcessTZ('UTC');
    const asUTC = await getWeeklyVolumeRoute('?weeks=2');
    expect(asUTC.status).toBe(200);
    const utcBucket = asUTC.body.data.find((w: { week: string }) => w.week === '2026-08-03');
    expect(utcBucket?.muscles['pecho'].hardSets, JSON.stringify(asUTC.body.data)).toBe(1);
  });

  // m11 (calendar-vs-raw-24h arithmetic, invisible in BA -- no DST since 2009): deliberately
  // NOT repeated here. The primitives it would exercise (`addCalendarDays`, `startOfLocalDate`)
  // are already exhaustively covered against a 23-zone corpus in day-window-in-zone.test.ts,
  // and PR A/B each already paid for a Cairo-anchored instance of this exact mutant class
  // against the SAME shared functions `getWeeklyVolume` now also calls. What is genuinely NEW
  // for this PR is the Monday-alignment step (D8/Q4), covered below by m14 -- that one is NOT
  // DST-invisible (it fails in every zone, including BA), so it earns its own fixture instead
  // of borrowing Cairo. Inspection coverage for m11 here, not test coverage -- documented, not
  // silently skipped (same reasoning PR B used for its own m20-equivalent cut).

  describe('R7 -- tz validation, weekly-volume and stats/volume call sites (shared code, compact)', () => {
    it('weekly-volume accepts the BA alias -> 200 (kills m16)', async () => {
      const res = await getWeeklyVolumeRoute(`?tz=${encodeURIComponent(BA)}`);
      expect(res.status).toBe(200);
    });

    it('weekly-volume rejects an invalid identifier without echoing it -> 400 (kills m15, m17)', async () => {
      const res = await getWeeklyVolumeRoute('?tz=Nope/Nope');
      expect(res.status).toBe(400);
      const details = String(res.body.error.details);
      expect(details).toContain('tz');
      expect(details).not.toContain('Nope/Nope');
    });

    it('stats/volume accepts the BA alias -> 200 (kills m16)', async () => {
      const res = await getVolumeStatsRoute(`?tz=${encodeURIComponent(BA)}`);
      expect(res.status).toBe(200);
    });

    it('stats/volume rejects an invalid identifier without echoing it -> 400 (kills m15, m17)', async () => {
      const res = await getVolumeStatsRoute('?tz=Nope/Nope');
      expect(res.status).toBe(400);
      const details = String(res.body.error.details);
      expect(details).toContain('tz');
      expect(details).not.toContain('Nope/Nope');
    });
  });

  // O3 + m18: the 400 for an invalid tz must be BYTE-IDENTICAL between /weekly-volume and
  // /dashboard -- `details`-as-string (D3), not Zod's `flatten()` object and not
  // errorHandler's third envelope.
  it('O3/m18: /weekly-volume 400 body equals /dashboard 400 body for the same invalid tz', async () => {
    const weeklyRes = await getWeeklyVolumeRoute('?tz=Nope/Nope');
    const dashboardRes = await getDashboard('?tz=Nope/Nope');

    expect(weeklyRes.status).toBe(400);
    expect(dashboardRes.status).toBe(400);
    expect(typeof weeklyRes.body.error.details).toBe('string');
    expect(weeklyRes.body).toEqual(dashboardRes.body);
  });

  // ---------------------------------------------------------------------
  // CEILING axis: TZ=UTC, NO ?tz=, one row in the future.
  // ---------------------------------------------------------------------

  // m6: sacar `lt` de getWeeklyVolume -- a set logged next week must not appear at all.
  it('m6: a set created next week never reaches the response', async () => {
    withProcessTZ('UTC');
    freeze('2026-08-05T18:00:00.000Z'); // Wed, mid current UTC week
    await seedSet('2026-08-12T15:00:00.000Z'); // next week

    const res = await getWeeklyVolumeRoute('?weeks=1');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // FORM axis: frozen clock, BA fixtures, tests the SHAPE of the range
  // (Monday alignment, current-vs-previous classification) rather than the
  // zone conversion itself -- same category as PR B's m12/m13.
  // ---------------------------------------------------------------------

  // m14/D8/Q4: the floor aligns to the Monday of `weeks-1` weeks before the CURRENT week's
  // Monday, never "now minus (weeks-1)*7 raw days" (unaligned). MEASURED (#3466 D8): with
  // `now` frozen at Wed 2026-08-05T18:00 UTC (15:00 BA) and `weeks=3`, the correct floor is
  // 2026-07-20T03:00:00.000Z (00:00 BA, Mon Jul20 -- 2 Mondays before this week's Monday Aug3);
  // the unaligned mutant floor is `now - 14d` = 2026-07-22T18:00:00.000Z (Wed Jul22, no Monday
  // alignment). A set logged 01:00 BA Jul20 (2026-07-20T04:00:00.000Z) sits AFTER the correct
  // floor but BEFORE the mutant one: included under D8, dropped under the mutant.
  it('m14: the floor aligns to Monday, not "now minus N weeks" unaligned', async () => {
    withProcessTZ('UTC');
    freeze('2026-08-05T18:00:00.000Z'); // Wed, 15:00 BA
    await seedSet('2026-07-20T04:00:00.000Z'); // 01:00 BA, Mon Jul20 -- the Monday itself

    const res = await getWeeklyVolumeRoute(`?weeks=3&tz=${encodeURIComponent(BA)}`);

    expect(res.status).toBe(200);
    const bucket = res.body.data.find((w: { week: string }) => w.week === '2026-07-20');
    expect(bucket, JSON.stringify(res.body.data)).toBeDefined();
  });

  // m7: /stats/volume classifies current-vs-previous by the CALLER's zone, not the process
  // clock. MEASURED (#3466 D10): `now` frozen at 10:00 BA Mon Aug3 (2026-08-03T13:00:00.000Z);
  // a session at 22:00 BA Sun Aug2 (2026-08-03T01:00:00.000Z) is the PREVIOUS BA week -- both
  // instants read as Monday under the process's own UTC clock, which is exactly the bug: under
  // raw UTC classification the session would land in `current`.
  it('m7: a session Sunday night BA counts as previous, not current, under the process clock', async () => {
    withProcessTZ('UTC');
    freeze('2026-08-03T13:00:00.000Z'); // Mon, 10:00 BA
    await seedSet('2026-08-03T01:00:00.000Z'); // Sun 22:00 BA

    const res = await getVolumeStatsRoute(`?tz=${encodeURIComponent(BA)}`);

    expect(res.status).toBe(200);
    expect(res.body.data['PECHO']).toBeDefined();
    expect(res.body.data['PECHO'].previous).toBe(80 * 8);
    expect(res.body.data['PECHO'].current ?? 0).toBe(0);
  });
});
