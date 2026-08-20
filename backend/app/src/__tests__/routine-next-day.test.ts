import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';
import { suggestNextRoutineDay } from '../services/routines.service';

/**
 * The weekday is an ARGUMENT now, so these tests state it instead of deriving it.
 *
 * They used to read `getCurrentDayOfWeekServer()` and assert the answer agreed
 * with it -- an inverted oracle: it pinned the very behaviour slice 4 removed
 * (the server's calendar deciding the user's weekday) and would have gone red
 * for the fix while being right on its own terms. Whose zone that weekday comes
 * from is a ROUTE concern, measured in routine-day-timezone.test.ts. What is
 * measured here is the rotation itself, and it no longer depends on the day the
 * suite happens to run.
 */
const ANCHOR = 'MIERCOLES' as const;
const NOT_ANCHOR = 'JUEVES' as const;

describe('suggestNextRoutineDay', () => {
  let userId: string;
  let authToken: string;
  let exerciseId: string;
  let routineId: string;
  let day1Id: string;
  let day2Id: string;
  let day3Id: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `nextday.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    const exercise = await prisma.exercise.create({ data: { name: `NextDay ${Date.now()}`, category: 'PECHO' } });
    exerciseId = exercise.id;

    const routine = await prisma.routine.create({ data: { name: 'NextDay PPL', userId } });
    routineId = routine.id;
    const d1 = await prisma.routineDay.create({ data: { routineId, name: 'Push', order: 1 } });
    const d2 = await prisma.routineDay.create({ data: { routineId, name: 'Pull', order: 2 } });
    const d3 = await prisma.routineDay.create({ data: { routineId, name: 'Legs', order: 3 } });
    day1Id = d1.id; day2Id = d2.id; day3Id = d3.id;
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.routine.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  // The three routine days below carry no weekday, so the weekday branch cannot
  // match and every answer here is pure rotation.
  it('suggests the first day when there is no session history', async () => {
    const day = await suggestNextRoutineDay(userId, routineId, ANCHOR);
    expect(day!.id).toBe(day1Id);
  });

  // Both rotation fixtures below log a set on purpose. A session with zero sets no
  // longer anchors the rotation, so without one they stop testing rotation at all:
  // 'the day after the last trained one' fails outright, and 'wraps around' keeps
  // passing for the wrong reason — the no-anchor fallback also answers days[0].
  async function trainDay(routineDayId: string, startedAt = new Date()) {
    const session = await prisma.workoutSession.create({
      data: { userId, routineId, routineDayId, startedAt, finishedAt: startedAt }
    });
    await prisma.workoutSet.create({
      data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 60, reps: 8 }
    });
    return session;
  }

  it('suggests the day after the last trained one', async () => {
    await trainDay(day1Id);
    const day = await suggestNextRoutineDay(userId, routineId, ANCHOR);
    expect(day!.id).toBe(day2Id);
  });

  it('wraps around after the last day', async () => {
    await trainDay(day3Id, new Date(Date.now() + 1000));
    const day = await suggestNextRoutineDay(userId, routineId, ANCHOR);
    expect(day!.id).toBe(day1Id);
  });

  it('returns null for a routine with no days', async () => {
    const empty = await prisma.routine.create({ data: { name: 'Empty', userId } });
    expect(await suggestNextRoutineDay(userId, empty.id, ANCHOR)).toBeNull();
  });

  it('anchors on the day whose weekday matches the given one, with no session history', async () => {
    const anchorRoutine = await prisma.routine.create({ data: { name: 'NextDay Anchor', userId } });

    const a1 = await prisma.routineDay.create({ data: { routineId: anchorRoutine.id, name: 'A1', order: 1 } });
    const a2 = await prisma.routineDay.create({
      data: { routineId: anchorRoutine.id, name: 'A2', order: 2, weekday: ANCHOR }
    });
    await prisma.routineDay.create({ data: { routineId: anchorRoutine.id, name: 'A3', order: 3 } });

    const day = await suggestNextRoutineDay(userId, anchorRoutine.id, ANCHOR);
    // The anchor day (a2) is NOT days[0] (a1), so this only passes if the
    // weekday-match branch actually ran instead of falling back to days[0].
    expect(day!.id).toBe(a2.id);
    // And the same fixture answers days[0] for a different weekday: the pair is
    // what proves the argument is read, rather than one call that could be
    // satisfied by any hardcoded branch.
    expect((await suggestNextRoutineDay(userId, anchorRoutine.id, NOT_ANCHOR))!.id).toBe(a1.id);
  });

  it('prefers the day anchored to the given weekday over the rotation', async () => {
    const todayRoutine = await prisma.routine.create({ data: { name: 'NextDay Today', userId } });
    await prisma.routineDay.create({ data: { routineId: todayRoutine.id, name: 'C1', order: 1 } });
    const c2 = await prisma.routineDay.create({
      data: { routineId: todayRoutine.id, name: 'C2', order: 2, weekday: ANCHOR }
    });
    const c3 = await prisma.routineDay.create({ data: { routineId: todayRoutine.id, name: 'C3', order: 3 } });

    // Train the anchored day so the rotation alone would answer c3.
    const session = await prisma.workoutSession.create({
      data: { userId, routineId: todayRoutine.id, routineDayId: c2.id, startedAt: new Date(), finishedAt: new Date() }
    });
    await prisma.workoutSet.create({
      data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 60, reps: 8 }
    });

    // Today's plan beats the rotation...
    expect((await suggestNextRoutineDay(userId, todayRoutine.id, ANCHOR))!.id).toBe(c2.id);
    // ...and the rotation still answers when no day is anchored to the weekday.
    expect((await suggestNextRoutineDay(userId, todayRoutine.id, NOT_ANCHOR))!.id).toBe(c3.id);
  });

  it('falls back to the first day when no day matches the given weekday', async () => {
    const fallbackRoutine = await prisma.routine.create({ data: { name: 'NextDay Fallback', userId } });

    const b1 = await prisma.routineDay.create({ data: { routineId: fallbackRoutine.id, name: 'B1', order: 1 } });
    await prisma.routineDay.create({
      data: { routineId: fallbackRoutine.id, name: 'B2', order: 2, weekday: NOT_ANCHOR }
    });

    const day = await suggestNextRoutineDay(userId, fallbackRoutine.id, ANCHOR);
    expect(day!.id).toBe(b1.id);
  });

  it('GET /api/routines/:id/next-day returns the suggestion', async () => {
    const res = await request(app)
      .get(`/api/routines/${routineId}/next-day`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(day1Id);
  });

  it('GET /api/routines/:id/next-day is 404 for a foreign routine', async () => {
    const other = await prisma.user.create({
      data: { email: `nextday.other.${Date.now()}@example.com`, password: 'password123' }
    });
    const foreign = await prisma.routine.create({ data: { name: 'Foreign', userId: other.id } });
    const res = await request(app)
      .get(`/api/routines/${foreign.id}/next-day`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(404);
    await prisma.routine.delete({ where: { id: foreign.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });
});
