import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startOfWeek, subWeeks, addWeeks, format } from 'date-fns';
import { prisma } from '../lib/prisma';
import { epleyE1RM, getExerciseProgression, getExercisePRs, getWeeklyVolume } from '../services/stats.service';

describe('epleyE1RM', () => {
  it('computes Epley for reps in range', () => {
    expect(epleyE1RM(100, 5)).toBeCloseTo(116.67, 1);
    expect(epleyE1RM(100, 1)).toBe(100 * (1 + 1 / 30));
  });
  it('returns null outside the validity window', () => {
    expect(epleyE1RM(100, 13)).toBeNull();
    expect(epleyE1RM(100, 0)).toBeNull();
    expect(epleyE1RM(0, 5)).toBeNull();
  });
});

describe('getExerciseProgression', () => {
  let userId: string;
  let exerciseId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `progression.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    const exercise = await prisma.exercise.create({
      data: { name: `Progression ${Date.now()}`, category: 'PECHO', primaryMuscles: ['pecho'] }
    });
    exerciseId = exercise.id;

    // Session 1 (older): warmup 40x10, TOP 100x5, DROP 80x8
    const s1 = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date('2026-07-01T10:00:00Z'), finishedAt: new Date('2026-07-01T11:00:00Z') }
    });
    await prisma.workoutSet.createMany({
      data: [
        { sessionId: s1.id, exerciseId, setNumber: 1, weightKg: 40, reps: 10, setType: 'WARMUP', isWarmup: true },
        { sessionId: s1.id, exerciseId, setNumber: 2, weightKg: 100, reps: 5, setType: 'TOP' },
        { sessionId: s1.id, exerciseId, setNumber: 3, weightKg: 80, reps: 8, setType: 'DROP' },
      ]
    });

    // Session 2 (newer): TOP 105x3
    const s2 = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date('2026-07-08T10:00:00Z'), finishedAt: new Date('2026-07-08T11:00:00Z') }
    });
    await prisma.workoutSet.create({
      data: { sessionId: s2.id, exerciseId, setNumber: 1, weightKg: 105, reps: 3, setType: 'TOP' }
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('returns one point per session, ascending, excluding warmups and drops correctly', async () => {
    const points = await getExerciseProgression(userId, exerciseId);
    expect(points).toHaveLength(2);
    // Session 1: topSetWeight ignores DROP? No — DROP is excluded from topSetWeight but counts in volume
    expect(points[0].topSetWeight).toBe(100);
    expect(points[0].volume).toBe(100 * 5 + 80 * 8); // warmup excluded, drop included
    expect(points[0].e1rm).toBeCloseTo(116.7, 1);
    expect(points[1].topSetWeight).toBe(105);
  });

  it('respects the from filter', async () => {
    const points = await getExerciseProgression(userId, exerciseId, { from: new Date('2026-07-05T00:00:00Z') });
    expect(points).toHaveLength(1);
    expect(points[0].topSetWeight).toBe(105);
  });

  /**
   * `limit` keeps the LATEST sessions, not the earliest.
   *
   * A progression is read to answer "am I getting stronger", so the end of the
   * series is the part that has to be there. Ordering ascending and then
   * cutting with `take` keeps the OLDEST N instead: an exercise with more
   * sessions than the limit would draw a chart that stops months ago and never
   * moves again, no matter how much the user trains.
   */
  it('keeps the most recent sessions when there are more than the limit', async () => {
    const points = await getExerciseProgression(userId, exerciseId, { limit: 1 });

    expect(points).toHaveLength(1);
    expect(points[0].topSetWeight).toBe(105);
  });

  it('returns the kept sessions oldest-first, so the chart reads left to right', async () => {
    const points = await getExerciseProgression(userId, exerciseId, { limit: 2 });

    expect(points.map(p => p.date)).toEqual([
      '2026-07-01T10:00:00.000Z',
      '2026-07-08T10:00:00.000Z',
    ]);
  });

  /**
   * The query already reads every set of every session it returns -- the map
   * just dropped them. The history sheet needs them one by one, and refetching
   * what the round trip already carried would be a second query for data that
   * was in hand.
   *
   * MUTATION NOTE: dropping the `id` tiebreaker from the SETS' own `orderBy`
   * survives this file. The fixture gives each set a distinct `setNumber`, so
   * there is no tie to expose. Seeding one would not fix that -- with the
   * tiebreaker gone the row order comes from the query plan, so the assertion
   * would pass or fail at random rather than on the code, which is the coin
   * flip `pagination-total-order.test.ts` documents at length. The tiebreaker
   * stays because nothing constrains `setNumber` to be unique within a session
   * and these rows are now rendered individually; it is cheap insurance with no
   * deterministic oracle, not covered ground.
   */
  it('carries the sets of each session, warmups included, in set order', async () => {
    const points = await getExerciseProgression(userId, exerciseId);

    expect(points[0].sets).toEqual([
      { setNumber: 1, weightKg: 40, reps: 10, setType: 'WARMUP' },
      { setNumber: 2, weightKg: 100, reps: 5, setType: 'TOP' },
      { setNumber: 3, weightKg: 80, reps: 8, setType: 'DROP' },
    ]);
    expect(points[1].sets).toEqual([
      { setNumber: 1, weightKg: 105, reps: 3, setType: 'TOP' },
    ]);
  });
});

describe('getExerciseProgression - DROP set e1RM regression', () => {
  let userId: string;
  let exerciseId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `dropregression.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    const exercise = await prisma.exercise.create({
      data: { name: `DropRegression ${Date.now()}`, category: 'PECHO', primaryMuscles: ['pecho'] }
    });
    exerciseId = exercise.id;

    // TOP 100x5 -> e1RM ~116.7; DROP 90x10 -> e1RM = 120 (higher than TOP)
    const session = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date('2026-07-10T10:00:00Z'), finishedAt: new Date('2026-07-10T11:00:00Z') }
    });
    await prisma.workoutSet.createMany({
      data: [
        { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 100, reps: 5, setType: 'TOP' },
        { sessionId: session.id, exerciseId, setNumber: 2, weightKg: 90, reps: 10, setType: 'DROP' },
      ]
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('reflects the DROP set e1RM when it exceeds the TOP set e1RM', async () => {
    const points = await getExerciseProgression(userId, exerciseId);
    expect(points).toHaveLength(1);
    expect(points[0].e1rm).toBeCloseTo(120, 1);
  });
});

describe('getExercisePRs', () => {
  let userId: string;
  let exerciseId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `prs.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    const exercise = await prisma.exercise.create({ data: { name: `PRs ${Date.now()}`, category: 'PECHO' } });
    exerciseId = exercise.id;

    const mkSession = (iso: string) =>
      prisma.workoutSession.create({ data: { userId, startedAt: new Date(iso), finishedAt: new Date(iso) } });

    const s1 = await mkSession('2026-06-01T10:00:00Z');
    const s2 = await mkSession('2026-06-08T10:00:00Z');
    const s3 = await mkSession('2026-06-15T10:00:00Z');

    // Explicit createdAt per set (matching each session's startedAt): getExercisePRs sorts by
    // set.createdAt, and a single createMany call would otherwise give every row the same
    // transaction timestamp, masking the intended chronological order.
    await prisma.workoutSet.createMany({
      data: [
        // s1: 100x5 (first PR), warmup 60x10 must be ignored even at high weight later
        { sessionId: s1.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10, setType: 'WARMUP', isWarmup: true, createdAt: new Date('2026-06-01T10:00:00Z') },
        { sessionId: s1.id, exerciseId, setNumber: 2, weightKg: 100, reps: 5, setType: 'TOP', createdAt: new Date('2026-06-01T10:00:00Z') },
        // s2: 100x7 (rep PR at 100, NOT weight PR), e1rm improves
        { sessionId: s2.id, exerciseId, setNumber: 1, weightKg: 100, reps: 7, setType: 'TOP', createdAt: new Date('2026-06-08T10:00:00Z') },
        // s3: 110x2 (weight PR, e1rm does not beat 100x7)
        { sessionId: s3.id, exerciseId, setNumber: 1, weightKg: 110, reps: 2, setType: 'TOP', createdAt: new Date('2026-06-15T10:00:00Z') },
      ]
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('tracks weight, e1rm and rep PRs chronologically, excluding warmups', async () => {
    const prs = await getExercisePRs(userId, exerciseId);
    expect(prs.weightPRs.map((p) => p.weightKg)).toEqual([100, 110]);
    // e1rm: 100x5=116.7 then 100x7=123.3; 110x2=117.3 does NOT beat 123.3
    expect(prs.e1rmPRs.map((p) => p.e1rm)).toEqual([116.7, 123.3]);
    const at100 = prs.repPRs.find((p) => p.weightKg === 100);
    expect(at100!.reps).toBe(7);
  });
});

describe('getExercisePRs - reopen-today mutation regression', () => {
  let userId: string;
  let exerciseId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `prs-reopen.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    const exercise = await prisma.exercise.create({ data: { name: `PRs Reopen ${Date.now()}`, category: 'PECHO' } });
    exerciseId = exercise.id;

    // Session A logged first (08:00), session B logged later the same day (14:00).
    const sessionA = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date('2026-07-13T08:00:00Z'), finishedAt: new Date('2026-07-13T08:30:00Z') }
    });
    const sessionB = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date('2026-07-13T14:00:00Z'), finishedAt: new Date('2026-07-13T14:30:00Z') }
    });

    // Set createdAt values are explicit and reflect true logging order: A's set was created
    // before B's set. This must stay the sort key — it is never mutated by anything.
    await prisma.workoutSet.create({
      data: {
        sessionId: sessionA.id, exerciseId, setNumber: 1, weightKg: 100, reps: 5, setType: 'TOP',
        createdAt: new Date('2026-07-13T08:00:00Z')
      }
    });
    await prisma.workoutSet.create({
      data: {
        sessionId: sessionB.id, exerciseId, setNumber: 1, weightKg: 110, reps: 3, setType: 'TOP',
        createdAt: new Date('2026-07-13T14:00:00Z')
      }
    });

    // Simulate the reopen-today path (workouts.service.ts ~L74-89): session A is reopened at
    // 17:00, which mutates session.startedAt to "now" — LATER than session B's startedAt.
    // This must NOT change PR ordering, because ordering is keyed off immutable set.createdAt.
    await prisma.workoutSession.update({
      where: { id: sessionA.id },
      data: { startedAt: new Date('2026-07-13T17:00:00Z'), finishedAt: null }
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('keeps both weight PRs after a session is reopened, dated by set.createdAt not session.startedAt', async () => {
    const prs = await getExercisePRs(userId, exerciseId);
    expect(prs.weightPRs.map((p) => p.weightKg)).toEqual([100, 110]);
    expect(prs.weightPRs[0].date).toBe('2026-07-13T08:00:00.000Z');
    expect(prs.weightPRs[1].date).toBe('2026-07-13T14:00:00.000Z');
  });
});

describe('getWeeklyVolume', () => {
  let userId: string;
  let benchId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `weeklyvol.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    const bench = await prisma.exercise.create({
      data: { name: `WeeklyVol Bench ${Date.now()}`, category: 'PECHO', primaryMuscles: ['pecho', 'triceps'] }
    });
    benchId = bench.id;

    const session = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date(), finishedAt: new Date() }
    });
    await prisma.workoutSet.createMany({
      data: [
        { sessionId: session.id, exerciseId: benchId, setNumber: 1, weightKg: 40, reps: 10, setType: 'WARMUP', isWarmup: true },
        { sessionId: session.id, exerciseId: benchId, setNumber: 2, weightKg: 80, reps: 8, setType: 'WORKING' },
        { sessionId: session.id, exerciseId: benchId, setNumber: 3, weightKg: 80, reps: 8, setType: 'WORKING' },
      ]
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: benchId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('counts hard sets and volume per muscle, excluding warmups, attributed to every primary muscle', async () => {
    // D11: `tz` is required, no service-level default. The process zone is what this test's
    // date-fns fixtures below already assumed implicitly, made explicit.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const weeklyVolume = await getWeeklyVolume(userId, 1, tz);
    expect(weeklyVolume).toHaveLength(1);
    const { muscles } = weeklyVolume[0];
    expect(muscles['pecho']).toEqual({ hardSets: 2, volume: 2 * 80 * 8 });
    expect(muscles['triceps']).toEqual({ hardSets: 2, volume: 2 * 80 * 8 });
  });
});

describe('getWeeklyVolume - reopen-today mutation regression', () => {
  let userId: string;
  let exerciseId: string;
  let weekNKey: string;
  let weekNPlus1Key: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `weeklyvol-reopen.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    const exercise = await prisma.exercise.create({
      data: { name: `WeeklyVol Reopen ${Date.now()}`, category: 'PECHO', primaryMuscles: ['pecho'] }
    });
    exerciseId = exercise.id;

    // Week N: the set is logged (createdAt) while the session originally also starts in week N.
    const weekNStart = startOfWeek(subWeeks(new Date(), 4), { weekStartsOn: 1 });
    const weekNPlus1Start = addWeeks(weekNStart, 1);
    weekNKey = format(weekNStart, 'yyyy-MM-dd');
    weekNPlus1Key = format(weekNPlus1Start, 'yyyy-MM-dd');

    const session = await prisma.workoutSession.create({
      data: { userId, startedAt: weekNStart, finishedAt: new Date(weekNStart.getTime() + 60 * 60 * 1000) }
    });
    await prisma.workoutSet.create({
      data: {
        sessionId: session.id, exerciseId, setNumber: 1, weightKg: 100, reps: 5, setType: 'WORKING',
        createdAt: weekNStart,
      }
    });

    // Simulate the reopen-today path (workouts.service.ts ~L74-89): reopening mutates
    // session.startedAt into week N+1, LATER than the set's immutable createdAt. Weekly volume
    // must still bucket the set into week N.
    await prisma.workoutSession.update({
      where: { id: session.id },
      data: { startedAt: weekNPlus1Start, finishedAt: null }
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('buckets the set into the week of set.createdAt, not the mutated session.startedAt', async () => {
    // D11: `tz` is required. Same reasoning as the test above.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const weeklyVolume = await getWeeklyVolume(userId, 8, tz);
    const weekNEntry = weeklyVolume.find((w) => w.week === weekNKey);
    const weekNPlus1Entry = weeklyVolume.find((w) => w.week === weekNPlus1Key);

    expect(weekNEntry).toBeDefined();
    expect(weekNEntry!.muscles['pecho']).toEqual({ hardSets: 1, volume: 100 * 5 });
    expect(weekNPlus1Entry).toBeUndefined();
  });
});
