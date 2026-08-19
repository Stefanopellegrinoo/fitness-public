import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';
import { suggestNextRoutineDay } from '../services/routines.service';

/**
 * A session with zero sets holds no training data. That is already the rule the
 * stale sweep, `startWorkout` step 5 (PR #20) and `GET /workouts/sessions` (PR #21)
 * apply, and all three spell it the same way: `sets: { some: {} }`.
 *
 * Three surfaces still disagreed, measured against the real database on 2026-07-30:
 *   - GET /progress/workouts  counted them as sessions AND marked their day active
 *   - GET /dashboard          counted them as weekly workouts AND as active minutes
 *   - suggestNextRoutineDay   let them ADVANCE the routine-day rotation
 *
 * Guarantees under test:
 *   G1  /progress/workouts never counts a zero-set session in `sessions`
 *   G2  /progress/workouts never marks a day active when every session that day is empty
 *   G3  "has training data" means "has sets", not "has volume" — a warmup-only session counts
 *   G4  /progress/workouts keeps its userId scope and its startedAt window
 *   G5  a day mixing an empty and a real session stays active, contributing one session
 *   G6  dashboard weeklyWorkouts never counts a zero-set session; activeMinutes follows
 *   G7  dashboard keeps its userId scope and its startOfWeek window
 *   G8  suggestNextRoutineDay never anchors the rotation on a zero-set session
 *   G9  it anchors on the MOST RECENT session that has sets
 *   G10 with only empty sessions it has no anchor at all and falls back to weekday/first
 *   G11 it keeps its userId and routineId scoping
 *   G12 it keeps its `routineDayId: { not: null }` filter, so a session with sets but
 *       no routine day never becomes the anchor and drops the rotation
 *
 * Every test owns its own user, created in `beforeEach` and dropped in `afterEach`,
 * so a failing assertion cannot cascade into the next one. A matrix row that dies by
 * someone else's leftovers measures nothing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function localNoonDaysAgo(days: number): Date {
  const d = new Date(Date.now() - days * DAY_MS);
  d.setHours(12, 0, 0, 0);
  return d;
}

describe('empty workout sessions are excluded from progress, dashboard and day rotation', () => {
  let exerciseId: string;
  let userId: string;
  let otherUserId: string;
  let authToken: string;

  beforeAll(async () => {
    const exercise = await prisma.exercise.create({
      data: { name: `EmptySessions ${Date.now()}`, category: 'PECHO', primaryMuscles: ['pecho'] },
    });
    exerciseId = exercise.id;
  });

  afterAll(async () => {
    await prisma.exercise.delete({ where: { id: exerciseId } });
  });

  beforeEach(async () => {
    const stamp = `${Date.now()}.${Math.random()}`;
    const user = await prisma.user.create({
      data: { email: `empty.main.${stamp}@example.com`, password: 'password123' },
    });
    const other = await prisma.user.create({
      data: { email: `empty.other.${stamp}@example.com`, password: 'password123' },
    });
    userId = user.id;
    otherUserId = other.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
  });

  afterEach(async () => {
    const owners = { in: [userId, otherUserId] };
    await prisma.workoutSet.deleteMany({ where: { session: { userId: owners } } });
    await prisma.workoutSession.deleteMany({ where: { userId: owners } });
    await prisma.routine.deleteMany({ where: { userId: owners } });
    await prisma.user.deleteMany({ where: { id: owners } });
  });

  async function seedSession(opts: {
    owner?: string;
    startedAt: Date;
    sets: number;
    setType?: 'WORKING' | 'WARMUP';
    routineId?: string;
    routineDayId?: string;
  }) {
    const session = await prisma.workoutSession.create({
      data: {
        userId: opts.owner ?? userId,
        startedAt: opts.startedAt,
        finishedAt: opts.startedAt,
        routineId: opts.routineId ?? null,
        routineDayId: opts.routineDayId ?? null,
      },
    });
    for (let n = 1; n <= opts.sets; n++) {
      await prisma.workoutSet.create({
        data: {
          sessionId: session.id,
          exerciseId,
          setNumber: n,
          weightKg: 100,
          reps: 10,
          setType: opts.setType ?? 'WORKING',
        },
      });
    }
    return session;
  }

  describe('GET /api/progress/workouts', () => {
    const sumOf = (data: Array<Record<string, number>>, key: string) =>
      data.reduce((total, point) => total + point[key], 0);

    async function getProgress(weeks: number) {
      const res = await request(app)
        .get(`/api/progress/workouts?weeks=${weeks}`)
        .set('Cookie', [`auth_token=${authToken}`]);
      expect(res.status).toBe(200);
      return res.body.data as Array<Record<string, number>>;
    }

    // G1 + G2. The two numbers this endpoint reports about "did you train" both had
    // to move: the raw session count and the distinct-active-day count.
    it('drops the empty session from `sessions` and its day from `activeDays`', async () => {
      await seedSession({ startedAt: localNoonDaysAgo(3), sets: 1 });
      await seedSession({ startedAt: localNoonDaysAgo(4), sets: 0 });

      const data = await getProgress(2);

      expect(sumOf(data, 'sessions')).toBe(1);
      expect(sumOf(data, 'activeDays')).toBe(1);
      expect(sumOf(data, 'volume')).toBe(100 * 10);
    });

    // G5. Same calendar day, one abandoned session and one real one: the day stays
    // active — the user DID train it — while contributing exactly one session.
    it('keeps a day active when only some of its sessions are empty', async () => {
      const noon = localNoonDaysAgo(3);
      const evening = new Date(noon);
      evening.setHours(17, 0, 0, 0);
      await seedSession({ startedAt: noon, sets: 0 });
      await seedSession({ startedAt: evening, sets: 2 });

      const data = await getProgress(2);

      expect(sumOf(data, 'sessions')).toBe(1);
      expect(sumOf(data, 'activeDays')).toBe(1);
      expect(sumOf(data, 'volume')).toBe(2 * 100 * 10);
    });

    // G3. "Has training data" is "has sets", not "has volume". A warmup-only session
    // is real logged work and has to survive, even though the volume aggregation
    // deliberately skips warmups — so this fixture reports 1 session with 0 volume.
    //
    // Passes on main: its proof is the mutation, not a prior red.
    it('still counts a session whose only sets are warmups', async () => {
      await seedSession({ startedAt: localNoonDaysAgo(3), sets: 2, setType: 'WARMUP' });

      const data = await getProgress(2);

      expect(sumOf(data, 'sessions')).toBe(1);
      expect(sumOf(data, 'activeDays')).toBe(1);
      expect(sumOf(data, 'volume')).toBe(0);
    });

    // G4, the counterweight: the new key lands in the same `where` that carries the
    // ownership scope and the time window, so both have to be pinned there too.
    //
    // Passes on main: its proof is the mutations, not a prior red.
    it("ignores another user's sessions and anything older than the window", async () => {
      await seedSession({ startedAt: localNoonDaysAgo(3), sets: 1 });
      await seedSession({ owner: otherUserId, startedAt: localNoonDaysAgo(3), sets: 4 });
      await seedSession({ startedAt: localNoonDaysAgo(40), sets: 4 });

      const data = await getProgress(2);

      expect(sumOf(data, 'sessions')).toBe(1);
      expect(sumOf(data, 'volume')).toBe(100 * 10);
    });
  });

  describe('GET /api/dashboard', () => {
    async function getSummary() {
      const res = await request(app)
        .get('/api/dashboard')
        .set('Cookie', [`auth_token=${authToken}`]);
      expect(res.status).toBe(200);
      return res.body.data as { weeklyWorkouts: number; activeMinutes: number };
    }

    // G6. `activeMinutes` is `weeklyWorkouts * 45`, so an empty session did not just
    // inflate a counter: it invented 45 minutes of training that never happened.
    it('does not count an empty session as a weekly workout, nor as active minutes', async () => {
      await seedSession({ startedAt: new Date(), sets: 2 });
      await seedSession({ startedAt: new Date(), sets: 0 });

      const summary = await getSummary();

      expect(summary.weeklyWorkouts).toBe(1);
      expect(summary.activeMinutes).toBe(45);
    });

    // G7, the counterweight: same `where`, same two scopes to pin. Eight days back is
    // always before `startOfWeek(now, monday)`, which is at most six days back.
    //
    // Passes on main: its proof is the mutations, not a prior red.
    it("ignores another user's week and anything before this week", async () => {
      await seedSession({ startedAt: new Date(), sets: 2 });
      await seedSession({ owner: otherUserId, startedAt: new Date(), sets: 3 });
      await seedSession({ startedAt: new Date(Date.now() - 8 * DAY_MS), sets: 3 });

      const summary = await getSummary();

      expect(summary.weeklyWorkouts).toBe(1);
      expect(summary.activeMinutes).toBe(45);
    });
  });

  describe('suggestNextRoutineDay', () => {
    // Every routine here leaves `weekday` unset on purpose, so the no-anchor fallback
    // is deterministically `days[0]` instead of depending on which day the suite runs.
    //
    // Which makes the weekday argument below unable to match anything, and that is
    // the point: it is pinned to a constant rather than passed as "today" so these
    // rotation assertions stay independent of the clock AND the zone the suite runs
    // under. If a change here ever makes the answer depend on ANY_DAY, this fixture
    // stopped testing rotation.
    const ANY_DAY = 'LUNES' as const;
    async function makeRoutine(name: string, dayNames: string[], owner = userId) {
      const routine = await prisma.routine.create({ data: { name, userId: owner } });
      const days = [];
      for (let i = 0; i < dayNames.length; i++) {
        days.push(
          await prisma.routineDay.create({
            data: { routineId: routine.id, name: dayNames[i], order: i + 1 },
          })
        );
      }
      return { routine, days };
    }

    // G8. The whole point: start a workout, log nothing, and the rotation moves on
    // without you. The next real workout then serves the day AFTER the one you never
    // trained, so you train the wrong day.
    it('does not let an empty session advance the rotation', async () => {
      const { routine, days } = await makeRoutine('Empty advances', ['D1', 'D2', 'D3']);
      await seedSession({ startedAt: localNoonDaysAgo(2), sets: 3, routineId: routine.id, routineDayId: days[0].id });
      await seedSession({ startedAt: localNoonDaysAgo(1), sets: 0, routineId: routine.id, routineDayId: days[1].id });

      const next = await suggestNextRoutineDay(userId, routine.id, ANY_DAY);

      expect(next!.id).toBe(days[1].id);
    });

    // G9. The anchor is the most recent session WITH sets, not the oldest one: D1 and
    // D2 were both really trained, so skipping the empty D3 has to answer D3, not D2.
    it('anchors on the most recent session that has sets, not the oldest', async () => {
      const { routine, days } = await makeRoutine('Most recent anchor', ['E1', 'E2', 'E3']);
      await seedSession({ startedAt: localNoonDaysAgo(3), sets: 2, routineId: routine.id, routineDayId: days[0].id });
      await seedSession({ startedAt: localNoonDaysAgo(2), sets: 2, routineId: routine.id, routineDayId: days[1].id });
      await seedSession({ startedAt: localNoonDaysAgo(1), sets: 0, routineId: routine.id, routineDayId: days[2].id });

      const next = await suggestNextRoutineDay(userId, routine.id, ANY_DAY);

      expect(next!.id).toBe(days[2].id);
    });

    // G10. With nothing but empty sessions there is no anchor at all, so the routine
    // has to answer like one that was never started: the first day, not the second.
    it('falls back to the first day when every session for the routine is empty', async () => {
      const { routine, days } = await makeRoutine('All empty', ['F1', 'F2', 'F3']);
      await seedSession({ startedAt: localNoonDaysAgo(1), sets: 0, routineId: routine.id, routineDayId: days[0].id });

      const next = await suggestNextRoutineDay(userId, routine.id, ANY_DAY);

      expect(next!.id).toBe(days[0].id);
    });

    // G11, the routine half. The newest session with sets belongs to ANOTHER routine,
    // so unscoping `routineId` swaps a real rotation (answer: G2) for the no-anchor
    // fallback (answer: G1). The two answers differ, which is what makes this an oracle
    // instead of a test that passes under both orderings.
    //
    // Passes on main: its proof is the mutation, not a prior red.
    it("does not anchor on another routine's session", async () => {
      const mine = await makeRoutine('Scoped mine', ['G1', 'G2']);
      const neighbour = await makeRoutine('Scoped neighbour', ['H1', 'H2']);
      await seedSession({ startedAt: localNoonDaysAgo(3), sets: 2, routineId: mine.routine.id, routineDayId: mine.days[0].id });
      await seedSession({ startedAt: localNoonDaysAgo(1), sets: 2, routineId: neighbour.routine.id, routineDayId: neighbour.days[1].id });

      const next = await suggestNextRoutineDay(userId, mine.routine.id, ANY_DAY);

      expect(next!.id).toBe(mine.days[1].id);
    });

    // G11, the ownership half. A row whose session and routine have different owners is
    // exactly the cross-tenant shape the ownership audit looks for; it is created here on purpose because
    // it is the only fixture that can tell a `where` that scopes by user from one that
    // does not — unscoped, the intruder's I2 is the newest and the answer becomes I3.
    // `afterEach` deletes both users' rows, so nothing survives the test.
    //
    // Passes on main: its proof is the mutation, not a prior red.
    it("does not anchor on another user's session over the same routine", async () => {
      const { routine, days } = await makeRoutine('Scoped by owner', ['I1', 'I2', 'I3']);
      await seedSession({ startedAt: localNoonDaysAgo(3), sets: 2, routineId: routine.id, routineDayId: days[0].id });
      await seedSession({ owner: otherUserId, startedAt: localNoonDaysAgo(1), sets: 2, routineId: routine.id, routineDayId: days[1].id });

      const next = await suggestNextRoutineDay(userId, routine.id, ANY_DAY);

      expect(next!.id).toBe(days[1].id);
    });

    // G12. Preexisting guarantee, no test until the mutation matrix of this change
    // found it unprotected: dropping `routineDayId: { not: null }` from the same
    // `where` this change touches leaves the suite 643/643 green.
    //
    // The row it needs is reachable, not hypothetical. `startWorkout`
    // (workouts.service.ts:212-214) resolves the day as
    // `weekdayMatch ?? suggestNextRoutineDay(...) ?? null`, so a routine with no day
    // for today and no rotation answer — a routine with zero days — creates a session
    // with `routineId` set and `routineDayId` NULL, and that session can still log
    // sets, because exercises are linked ad hoc. Add days to the routine afterwards
    // and that row is the newest one with sets.
    //
    // Unfiltered it becomes the anchor, `lastSession.routineDayId` is null, the
    // `if` never runs and the rotation falls back to weekday/days[0] instead of the
    // day after the last one actually trained. The two answers differ, which is what
    // makes this fixture an oracle.
    it('does not lose the anchor to a session that has sets but no routine day', async () => {
      const { routine, days } = await makeRoutine('No day anchor', ['J1', 'J2', 'J3']);
      await seedSession({ startedAt: localNoonDaysAgo(3), sets: 2, routineId: routine.id, routineDayId: days[0].id });
      await seedSession({ startedAt: localNoonDaysAgo(1), sets: 2, routineId: routine.id });

      const next = await suggestNextRoutineDay(userId, routine.id, ANY_DAY);

      expect(next!.id).toBe(days[1].id);
    });
  });
});
