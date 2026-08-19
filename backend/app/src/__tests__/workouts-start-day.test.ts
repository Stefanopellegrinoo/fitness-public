import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';
import { suggestNextRoutineDay } from '../services/routines.service';

describe('startWorkout day resolution + plan snapshot', () => {
  let userId: string;
  let authToken: string;
  let exPush: string;
  let exPull: string;
  let routineId: string;
  let pushDayId: string;
  let pullDayId: string;
  let legsDayId: string;
  let exLegs: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `startday.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    const [a, b, c] = await Promise.all([
      prisma.exercise.create({ data: { name: `StartDay Push ${Date.now()}`, category: 'PECHO' } }),
      prisma.exercise.create({ data: { name: `StartDay Pull ${Date.now()}`, category: 'ESPALDA' } }),
      prisma.exercise.create({ data: { name: `StartDay Legs ${Date.now()}`, category: 'PIERNAS' } }),
    ]);
    exPush = a.id;
    exPull = b.id;
    exLegs = c.id;

    const routine = await prisma.routine.create({ data: { name: 'StartDay PPL', userId } });
    routineId = routine.id;
    const pushDay = await prisma.routineDay.create({
      data: { routineId, name: 'Push', order: 1, weekday: 'LUNES' }
    });
    pushDayId = pushDay.id;
    const pullDay = await prisma.routineDay.create({
      data: { routineId, name: 'Pull', order: 2, weekday: 'JUEVES' }
    });
    pullDayId = pullDay.id;
    await prisma.routineExercise.create({
      data: {
        routineId, dayId: pushDayId, exerciseId: exPush, order: 0, restSeconds: 120,
        setPlans: {
          create: [
            { order: 1, setType: 'TOP', repsMin: 4, repsMax: 6, targetRpe: 9 },
            { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 90 },
          ]
        }
      }
    });
    await prisma.routineExercise.create({
      data: { routineId, dayId: pullDayId, exerciseId: exPull, order: 0 }
    });

    const legsDay = await prisma.routineDay.create({
      data: { routineId, name: 'Legs', order: 3, weekday: 'MARTES' }
    });
    legsDayId = legsDay.id;
    await prisma.routineExercise.create({
      data: {
        routineId, dayId: legsDayId, exerciseId: exLegs, order: 0,
        setPlans: {
          create: [
            { order: 1, setType: 'WARMUP', repsMin: 10, repsMax: 10 },
            { order: 2, setType: 'WORKING', repsMin: 6, repsMax: 6, targetRpe: 8 },
            { order: 3, setType: 'WORKING', repsMin: 6, repsMax: 6, targetRpe: 8 },
          ]
        }
      }
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSessionExercise.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.routine.deleteMany({ where: { userId } });
    // All THREE, including exLegs -- the list said `[exPush, exPull]` while the
    // setup above creates three, so every run left one behind in the shared
    // catalog. Exercises carry no `userId`, so no other delete here reaches them.
    await prisma.exercise.deleteMany({ where: { id: { in: [exPush, exPull, exLegs] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function closeSession(id: string) {
    await prisma.workoutSessionExercise.deleteMany({ where: { sessionId: id } });
    await prisma.workoutSession.delete({ where: { id } });
  }

  it('explicit routineDayId wins and the session records it', async () => {
    const res = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId, routineDayId: pullDayId });
    expect(res.status).toBe(201);
    expect(res.body.data.routineDayId).toBe(pullDayId);
    expect(res.body.data.exercises).toHaveLength(1);
    expect(res.body.data.exercises[0].exerciseId).toBe(exPull);
    await closeSession(res.body.data.id);
  });

  it('clientDay matches the weekday-anchored day and snapshots the plan', async () => {
    const res = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId, clientDay: 'LUNES' });
    expect(res.status).toBe(201);
    expect(res.body.data.routineDayId).toBe(pushDayId);
    const sessionExercise = res.body.data.exercises[0];
    expect(sessionExercise.planSnapshot).toHaveLength(2);
    expect(sessionExercise.planSnapshot[0]).toMatchObject({ order: 1, setType: 'TOP', repsMin: 4, repsMax: 6, targetRpe: 9 });
    // derived legacy dual-write keeps the current frontend rendering targets
    expect(sessionExercise.targetSets).toBe(2);
    expect(sessionExercise.targetReps).toBe('4-6');
    await closeSession(res.body.data.id);
  });

  it('non-matching clientDay falls back to the next-day suggestion', async () => {
    // SABADO anchors no day, so startWorkout must delegate to suggestNextRoutineDay.
    //
    // The expectation is read off the FIXTURE, not off the service. This used to
    // call `suggestNextRoutineDay(userId, routineId)` and assert the route agreed
    // with it -- which compared the path under test against itself, and agreed
    // just as happily when both sides read the server's clock instead of the
    // caller's SABADO. The three days here are LUNES/JUEVES/MARTES and every
    // earlier test deletes its session, so with no history and no SABADO day the
    // answer is fixed by the spec's last rung: first day by order.
    const res = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId, clientDay: 'SABADO' });
    expect(res.status).toBe(201);
    expect(res.body.data.routineDayId).toBe(pushDayId);
    await closeSession(res.body.data.id);
  });

  it('routineDayId not belonging to the routine is a 400', async () => {
    const foreignRoutine = await prisma.routine.create({ data: { name: 'Foreign', userId } });
    const foreignDay = await prisma.routineDay.create({
      data: { routineId: foreignRoutine.id, name: 'X', order: 1 }
    });
    const res = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId, routineDayId: foreignDay.id });
    expect(res.status).toBe(400);
    await prisma.routine.delete({ where: { id: foreignRoutine.id } });
  });

  it('an exercise with zero set plans yields an empty planSnapshot array', async () => {
    const res = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId, routineDayId: pullDayId });
    expect(res.body.data.exercises[0].planSnapshot).toEqual([]);
    expect(res.body.data.exercises[0].targetSets).toBeNull();
    await closeSession(res.body.data.id);
  });

  it('collapses legacy targets like Task 8: WARMUP excluded from targetSets, equal reps collapsed', async () => {
    const res = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId, routineDayId: legsDayId });
    expect(res.status).toBe(201);
    const sessionExercise = res.body.data.exercises[0];
    // planSnapshot keeps ALL set plans, including the warmup
    expect(sessionExercise.planSnapshot).toHaveLength(3);
    // derived legacy fields must match Task 8 semantics: warmup excluded, reps collapsed
    expect(sessionExercise.targetSets).toBe(2);
    expect(sessionExercise.targetReps).toBe('6');
    expect(sessionExercise.targetRpe).toBe(8);
    await closeSession(res.body.data.id);
  });

  // `routineDayId` was
  // validated at step 4, which the resume early-return at step 2 never reaches.
  // Measured on main 2026-07-29 with byte-identical bodies: 400 with no open
  // session, 201 with one — and the 201 hands back whatever day is already
  // running, discarding the day the caller asked for. Which of the two answers is
  // correct is not a toss-up: the 400 is the documented contract (the test above)
  // and dropping an already-parsed field is the accept-then-drop defect, so the
  // validation moves up rather than the rejection going away.
  describe('routineDayId validation does not depend on hidden session state', () => {
    // G1.
    it('rejects a routineDayId from another routine even when a session is open', async () => {
      const foreignRoutine = await prisma.routine.create({ data: { name: 'Foreign resume', userId } });
      const foreignDay = await prisma.routineDay.create({
        data: { routineId: foreignRoutine.id, name: 'X', order: 1 }
      });

      const seed = await request(app)
        .post('/api/workouts/start')
        .set('Cookie', [`auth_token=${authToken}`])
        .send({ routineId, routineDayId: pushDayId });
      expect(seed.status).toBe(201);

      try {
        const res = await request(app)
          .post('/api/workouts/start')
          .set('Cookie', [`auth_token=${authToken}`])
          .send({ routineId, routineDayId: foreignDay.id });

        // Byte-identical to the answer the same body gets with no open session.
        expect(res.status).toBe(400);
        expect(res.body.error.message).toBe('routineDayId does not belong to the routine');
      } finally {
        await closeSession(seed.body.data.id);
        await prisma.routine.delete({ where: { id: foreignRoutine.id } });
      }
    });

    // G2. Answering 400 is not enough on its own: validated at its old position the
    // rejection still arrives, but step 1's stale sweep has already run and deleted
    // rows on the way to an error the caller was always going to get. An empty
    // abandoned session is the exact shape that sweep DELETES, so its survival is
    // the observation that pins the ordering.
    it('rejects a bad routineDayId before the stale sweep writes anything', async () => {
      const foreignRoutine = await prisma.routine.create({ data: { name: 'Foreign presweep', userId } });
      const foreignDay = await prisma.routineDay.create({
        data: { routineId: foreignRoutine.id, name: 'X', order: 1 }
      });
      const stale = await prisma.workoutSession.create({
        data: { userId, startedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), finishedAt: null },
      });

      try {
        const res = await request(app)
          .post('/api/workouts/start')
          .set('Cookie', [`auth_token=${authToken}`])
          .send({ routineId, routineDayId: foreignDay.id });

        expect(res.status).toBe(400);
        const survivor = await prisma.workoutSession.findUnique({ where: { id: stale.id } });
        expect(survivor).not.toBeNull();
      } finally {
        await prisma.workoutSession.deleteMany({ where: { id: stale.id } });
        await prisma.routine.delete({ where: { id: foreignRoutine.id } });
      }
    });

    // G4. Ownership of the ROUTINE still decides before the day does.
    //
    // Parametrized over whether the day belongs to that foreign routine, because the
    // "belongs" case ALONE cannot tell the order: the day lookup succeeds either way
    // and the 404 comes out regardless — the first version of this test was written
    // that way and the reordering mutation walked straight through it. Only the
    // MISMATCHED day discriminates: checked in the right order both answer 404, and
    // with the day first the pair splits into 404 and 400, which hands an enumerator
    // a yes/no oracle for "does this routineDayId belong to that routine" on a
    // routine they do not own.
    //
    // Passes on main — its proof is the mutation, not a prior red.
    it.each([
      ['belongs to it', true],
      ['does not belong to it', false],
    ] as const)("answers 404 for another user's routine with a routineDayId that %s", async (_label, belongs) => {
      const userB = await prisma.user.create({
        data: { email: `startday-day-owner.${Date.now()}.${Math.random()}@example.com`, password: 'password123' }
      });
      try {
        const routineB = await prisma.routine.create({ data: { name: 'B routine', userId: userB.id } });
        const dayHost = belongs
          ? routineB
          : await prisma.routine.create({ data: { name: 'B other', userId: userB.id } });
        const dayB = await prisma.routineDay.create({
          data: { routineId: dayHost.id, name: 'BD', order: 1 }
        });

        const res = await request(app)
          .post('/api/workouts/start')
          .set('Cookie', [`auth_token=${authToken}`])
          .send({ routineId: routineB.id, routineDayId: dayB.id });

        expect(res.status).toBe(404);
        expect(res.body.error.message).toBe('Routine not found');
      } finally {
        await prisma.routine.deleteMany({ where: { userId: userB.id } });
        await prisma.user.delete({ where: { id: userB.id } });
      }
    });

    // G5. The day lookup is scoped by `routineId`, so without one there is nothing to
    // validate against and the field was simply dropped: measured on main, a valid
    // day, a nonexistent one and ANOTHER USER'S day all answered 201 with
    // `routineDayId: null` stored. The same accept-then-drop defect — accepted, parsed, discarded.
    it('rejects a routineDayId sent without a routineId instead of dropping it', async () => {
      const before = await prisma.workoutSession.count({ where: { userId } });

      const res = await request(app)
        .post('/api/workouts/start')
        .set('Cookie', [`auth_token=${authToken}`])
        .send({ routineDayId: pushDayId });

      expect(res.status).toBe(400);
      expect(await prisma.workoutSession.count({ where: { userId } })).toBe(before);
    });

    // G3, the counterweight: the new guard must not turn the case it exists to allow
    // into an error. It also pins, on purpose, what this PR does NOT change — a resume
    // still returns the day that is already running, not the one asked for. That is a
    // product question about resume semantics, not an input-validation bug, and it is
    // left as an open product question rather than answered here.
    it('still resumes the open session when the routineDayId is valid for that routine', async () => {
      const seed = await request(app)
        .post('/api/workouts/start')
        .set('Cookie', [`auth_token=${authToken}`])
        .send({ routineId, routineDayId: pushDayId });
      expect(seed.status).toBe(201);

      try {
        const res = await request(app)
          .post('/api/workouts/start')
          .set('Cookie', [`auth_token=${authToken}`])
          .send({ routineId, routineDayId: pullDayId });

        expect(res.status).toBe(201);
        expect(res.body.data.id).toBe(seed.body.data.id);
        expect(res.body.data.routineDayId).toBe(pushDayId);
      } finally {
        await closeSession(seed.body.data.id);
      }
    });
  });

  it('rejects starting a workout against another user\'s routine (404, no session created)', async () => {
    const userB = await prisma.user.create({
      data: { email: `startday-b.${Date.now()}@example.com`, password: 'password123' }
    });
    const tokenB = authService.generateTokens({ userId: userB.id, email: userB.email }).accessToken;

    const res = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${tokenB}`])
      .send({ routineId });

    expect(res.status).toBe(404);

    const sessionCount = await prisma.workoutSession.count({ where: { userId: userB.id } });
    expect(sessionCount).toBe(0);

    await prisma.user.delete({ where: { id: userB.id } });
  });
});
