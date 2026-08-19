import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';
import { workoutService } from '../services/workouts.service';

describe('Workout Routes (History)', () => {
  let userId: string;
  let authToken: string;
  let exerciseId: string;

  beforeAll(async () => {
    // 1. Setup User
    const user = await prisma.user.create({
      data: {
        email: `route.test.${Date.now()}@example.com`,
        password: 'password123',
        name: 'Route Tester'
      }
    });
    userId = user.id;

    // 2. Setup Auth (mock cookie/token)
    const tokens = authService.generateTokens({ userId: user.id, email: user.email });
    authToken = tokens.accessToken;

    // 3. Setup Exercise
    const exercise = await prisma.exercise.create({
      data: {
        name: `Incline Press ${Date.now()}`,
        category: 'PECHO',
        equipment: 'DUMBBELL'
      }
    });
    exerciseId = exercise.id;

    // 4. Setup History (session + sets)
    const session = await prisma.workoutSession.create({
      data: {
        userId,
        startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
        finishedAt: new Date(),
      }
    });

    await prisma.workoutSet.create({
      data: {
        sessionId: session.id,
        exerciseId,
        setNumber: 1,
        weightKg: 20,
        reps: 12
      }
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSessionExercise.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.routine.deleteMany({ where: { userId } });
    // The exercise too. It has no `userId`, so it survives every delete above
    // and outlives the run: this file leaked one row per execution into the
    // shared catalog, and the catalog is what the exercise picker lists.
    await prisma.exercise.deleteMany({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('GET /api/workouts/history/exercise/:exerciseId should return sets from last session', async () => {
    const res = await request(app)
      .get(`/api/workouts/history/exercise/${exerciseId}`)
      .set('Cookie', [`auth_token=${authToken}`]);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].weightKg).toBe(20);
  });

  // The service throws START_ROUTINE_CONFLICT when concurrent starts leave it
  // holding a session for a routine the caller never asked for. Only this test
  // covers the HTTP mapping: without it the message falls through asyncHandler
  // to the generic error handler and the user gets a 500.
  it('POST /api/workouts/start answers 409 when the open session is for another routine', async () => {
    const holderRoutine = await prisma.routine.create({ data: { name: 'Holder', userId } });
    const requestedRoutine = await prisma.routine.create({ data: { name: 'Requested', userId } });

    await prisma.workoutSession.updateMany({
      where: { userId, finishedAt: null },
      data: { finishedAt: new Date() },
    });
    await prisma.workoutSession.create({
      data: { userId, routineId: holderRoutine.id, startedAt: new Date(), finishedAt: null },
    });

    // Blind the resume check of the first attempt and of its retry, so both
    // creates lose to the partial index the holder owns and the retry budget is
    // spent. The convergence then finds a holder for the wrong routine.
    const realFindFirst = prisma.workoutSession.findFirst.bind(prisma.workoutSession);
    let blinded = 0;
    const findFirstSpy = vi
      .spyOn(prisma.workoutSession, 'findFirst')
      .mockImplementation((async (args: Prisma.WorkoutSessionFindFirstArgs) => {
        const where = args?.where ?? {};
        if (where.finishedAt === null && where.startedAt != null && blinded < 2) {
          blinded++;
          return null;
        }
        return await realFindFirst(args);
      }) as unknown as typeof prisma.workoutSession.findFirst);

    let res;
    try {
      res = await request(app)
        .post('/api/workouts/start')
        .set('Cookie', [`auth_token=${authToken}`])
        .send({ routineId: requestedRoutine.id });
    } finally {
      findFirstSpy.mockRestore();
    }

    expect(blinded).toBe(2);
    // Neither a 500 (what main did) nor a 201 carrying someone else's routine.
    expect(res!.status).toBe(409);
    expect(res!.body.error.message).toMatch(/different routine/i);

    await prisma.workoutSession.updateMany({
      where: { userId, finishedAt: null },
      data: { finishedAt: new Date() },
    });
  });

  // The service refuses writes into a finished session. Only these tests cover the
  // HTTP mapping: without them both messages fall through asyncHandler to the
  // generic handler and the client gets a 500 for two situations it could have
  // handled — a stale session id it should drop, and a typo it should not retry.
  it('POST /api/workouts/:id/sets answers 409 when the session is already finished', async () => {
    const closed = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date(Date.now() - 60_000), finishedAt: new Date() },
    });

    const res = await request(app)
      .post(`/api/workouts/${closed.id}/sets`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ exerciseId, setNumber: 1, weightKg: 40, reps: 10 });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/finished/i);

    const sets = await prisma.workoutSet.count({ where: { sessionId: closed.id } });
    expect(sets).toBe(0);
  });

  it('POST /api/workouts/:id/exercises answers 409 when the session is already finished', async () => {
    const closed = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date(Date.now() - 60_000), finishedAt: new Date() },
    });

    const res = await request(app)
      .post(`/api/workouts/${closed.id}/exercises`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ exerciseId });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/finished/i);

    const links = await prisma.workoutSessionExercise.count({ where: { sessionId: closed.id } });
    expect(links).toBe(0);
  });

  it('POST /api/workouts/:id/exercises answers 404 when the session does not exist', async () => {
    const res = await request(app)
      .post('/api/workouts/00000000-0000-0000-0000-000000000000/exercises')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ exerciseId });

    // 404 and not the 500 this used to produce: a missing session is a client
    // error the caller can act on, not a server fault.
    expect(res.status).toBe(404);
    // The status alone does not pin the route: notFoundMiddleware answers 404 for
    // any unmatched URL, so a renamed path would pass on status. It answers with a
    // flat `error` string, while this guard nests `{ error: { message } }` — the
    // body shape is what tells the two 404s apart.
    expect(res.body.error.message).toMatch(/session not found/i);
  });

  it('POST /api/workouts/:id/sets answers 404 when the session does not exist', async () => {
    const res = await request(app)
      .post('/api/workouts/00000000-0000-0000-0000-000000000000/sets')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ exerciseId, setNumber: 1, weightKg: 40, reps: 10 });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/session not found/i);
  });

  // The set routes close the same door the insert paths do. Guarding only the
  // insert leaves the same stale session id able to rewrite and delete rows of a
  // finished workout — measured at 200 before this guard existed.
  const setInFinishedSession = async (setNumber: number) => {
    const closed = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date(Date.now() - 60_000), finishedAt: new Date() },
    });
    return await prisma.workoutSet.create({
      data: { sessionId: closed.id, exerciseId, setNumber, weightKg: 100, reps: 5 },
    });
  };

  it('PATCH /api/workouts/sets/:id answers 409 and leaves the row untouched when the session is finished', async () => {
    const set = await setInFinishedSession(11);

    const res = await request(app)
      .patch(`/api/workouts/sets/${set.id}`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ weightKg: 999 });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/finished/i);

    const stored = await prisma.workoutSet.findUnique({ where: { id: set.id } });
    expect(stored?.weightKg).toBe(100);
  });

  it('DELETE /api/workouts/sets/:id answers 409 and keeps the row when the session is finished', async () => {
    const set = await setInFinishedSession(12);

    const res = await request(app)
      .delete(`/api/workouts/sets/${set.id}`)
      .set('Cookie', [`auth_token=${authToken}`]);

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/finished/i);

    const stored = await prisma.workoutSet.findUnique({ where: { id: set.id } });
    expect(stored).not.toBeNull();
  });

  it('PATCH and DELETE /api/workouts/sets/:id answer 404 for a set id that does not exist', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';

    const patched = await request(app)
      .patch(`/api/workouts/sets/${missing}`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ weightKg: 50 });
    const deleted = await request(app)
      .delete(`/api/workouts/sets/${missing}`)
      .set('Cookie', [`auth_token=${authToken}`]);

    expect(patched.status).toBe(404);
    expect(deleted.status).toBe(404);
    // Nested body, like the rest of these guards: notFoundMiddleware answers 404
    // with a flat `error` string for any unmatched URL, so status alone would also
    // pass if the route were renamed away.
    expect(patched.body.error.message).toMatch(/set not found/i);
    expect(deleted.body.error.message).toMatch(/set not found/i);
  });

  // Ownership decides BEFORE writability, and both answer the SAME 404 as a set that
  // does not exist: a 409 here would confirm someone else's set id is real.
  //
  // The finished case is the one that pins the ORDER. With an open foreign session
  // either order answers 404, so testing only that leaves the checks free to swap —
  // and swapped, a foreign set in a finished session answers 409 while a nonexistent
  // id answers 404, which is a uuid-enumeration oracle.
  it.each([
    ['OPEN', null],
    ['FINISHED', new Date()],
  ] as const)('PATCH and DELETE /api/workouts/sets/:id answer 404 for another user\'s set, session %s', async (_label, finishedAt) => {
    const other = await prisma.user.create({
      data: { email: `route.other.${Date.now()}.${Math.random()}@example.com`, password: 'password123', name: 'Other' },
    });
    try {
      const otherSession = await prisma.workoutSession.create({
        data: { userId: other.id, startedAt: new Date(Date.now() - 60_000), finishedAt },
      });
      const otherSet = await prisma.workoutSet.create({
        data: { sessionId: otherSession.id, exerciseId, setNumber: 1, weightKg: 100, reps: 5 },
      });

      const patched = await request(app)
        .patch(`/api/workouts/sets/${otherSet.id}`)
        .set('Cookie', [`auth_token=${authToken}`])
        .send({ weightKg: 999 });
      const deleted = await request(app)
        .delete(`/api/workouts/sets/${otherSet.id}`)
        .set('Cookie', [`auth_token=${authToken}`]);

      expect(patched.status).toBe(404);
      expect(deleted.status).toBe(404);
      // Byte-identical to the answer for a set id that does not exist. A different
      // message is a different answer, and the difference IS the disclosure.
      expect(patched.body.error.message).toBe('Set not found');
      expect(deleted.body.error.message).toBe('Set not found');

      const stored = await prisma.workoutSet.findUnique({ where: { id: otherSet.id } });
      expect(stored?.weightKg).toBe(100);
    } finally {
      await prisma.workoutSet.deleteMany({ where: { session: { userId: other.id } } });
      await prisma.workoutSessionExercise.deleteMany({ where: { session: { userId: other.id } } });
      await prisma.workoutSession.deleteMany({ where: { userId: other.id } });
      await prisma.user.delete({ where: { id: other.id } });
    }
  });

  // Only ONE open session per user can exist at a time — the partial unique index
  // WorkoutSession_one_open_per_user enforces it — so a test that needs an open session
  // has to give it back, or the next create in this file dies with a P2002 that has
  // nothing to do with what that test is checking.
  const withOpenSession = async (fn: (sessionId: string) => Promise<void>) => {
    const session = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date(), finishedAt: null },
    });
    try {
      await fn(session.id);
    } finally {
      await prisma.workoutSet.deleteMany({ where: { sessionId: session.id } });
      await prisma.workoutSessionExercise.deleteMany({ where: { sessionId: session.id } });
      await prisma.workoutSession.delete({ where: { id: session.id } });
    }
  };

  // The helper only owns the two sentinels; everything else has to keep surfacing as a
  // 500. Without this, mapping every unmapped fault to a 404 passes the whole suite,
  // and genuine faults on these four routes would be swallowed as client errors.
  it('lets a non-sentinel failure surface as 500 instead of mapping it', async () => {
    await withOpenSession(async (sessionId) => {
      const boom = vi.spyOn(workoutService, 'addWorkoutSet').mockRejectedValueOnce(new Error('DB_EXPLODED'));
      try {
        const res = await request(app)
          .post(`/api/workouts/${sessionId}/sets`)
          .set('Cookie', [`auth_token=${authToken}`])
          .send({ exerciseId, setNumber: 1, weightKg: 40, reps: 10 });

        expect(res.status).toBe(500);
      } finally {
        boom.mockRestore();
      }
    });
  });

  // PATCH /workouts/:id had no test at all, and neither of its two guards existed.
  describe('PATCH /api/workouts/:id', () => {
    const withOtherUser = async (fn: (other: { id: string }) => Promise<void>) => {
      const other = await prisma.user.create({
        data: { email: `route.patch.${Date.now()}.${Math.random()}@example.com`, password: 'password123', name: 'Other' },
      });
      try {
        await fn(other);
      } finally {
        await prisma.workoutSet.deleteMany({ where: { session: { userId: other.id } } });
        await prisma.workoutSessionExercise.deleteMany({ where: { session: { userId: other.id } } });
        await prisma.workoutSession.deleteMany({ where: { userId: other.id } });
        await prisma.routine.deleteMany({ where: { userId: other.id } });
        await prisma.user.delete({ where: { id: other.id } });
      }
    };

    // Parametrized over the foreign session's state for the same reason the set routes
    // are: with an OPEN foreign session either check order answers 404, so only the
    // FINISHED case can tell whether ownership is decided before state. Swapped, someone
    // else's finished session answers 409 and a nonexistent id answers 404 — the
    // difference confirms the id is real.
    it.each([
      ['OPEN', null],
      ['FINISHED', new Date()],
    ] as const)("answers 404 for another user's session, %s", async (_label, finishedAt) => {
      await withOtherUser(async (other) => {
        const foreign = await prisma.workoutSession.create({
          data: { userId: other.id, startedAt: new Date(Date.now() - 60_000), finishedAt },
        });

        const res = await request(app)
          .patch(`/api/workouts/${foreign.id}`)
          .set('Cookie', [`auth_token=${authToken}`])
          .send({ notes: 'intruso' });

        expect(res.status).toBe(404);
        expect(res.body.error.message).toBe('Workout session not found');

        const stored = await prisma.workoutSession.findUnique({ where: { id: foreign.id } });
        expect(stored?.notes).toBeNull();
      });
    });

    it('answers 409 and writes nothing when the session is already finished', async () => {
      const closed = await prisma.workoutSession.create({
        data: { userId, startedAt: new Date(Date.now() - 60_000), finishedAt: new Date(), notes: 'original' },
      });

      const res = await request(app)
        .patch(`/api/workouts/${closed.id}`)
        .set('Cookie', [`auth_token=${authToken}`])
        .send({ notes: 'reescrito' });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/finished/i);

      const stored = await prisma.workoutSession.findUnique({ where: { id: closed.id } });
      expect(stored?.notes).toBe('original');
    });

    // Owning the session says nothing about owning the routine. Writing a foreign
    // routineId here would come back out of GET /sessions, getActiveWorkout and a
    // resumed start, all of which include the relation and trust the FK.
    it("answers 404 and writes nothing for another user's routineId", async () => {
      await withOtherUser(async (other) => {
        const foreignRoutine = await prisma.routine.create({
          data: { userId: other.id, name: 'Rutina ajena' },
        });

        await withOpenSession(async (sessionId) => {
          const res = await request(app)
            .patch(`/api/workouts/${sessionId}`)
            .set('Cookie', [`auth_token=${authToken}`])
            .send({ routineId: foreignRoutine.id });

          expect(res.status).toBe(404);
          expect(res.body.error.message).toBe('Routine not found');

          const stored = await prisma.workoutSession.findUnique({ where: { id: sessionId } });
          expect(stored?.routineId).toBeNull();
        });
      });
    });

    // The counterweight: the guards must not refuse the case they exist to allow.
    it("accepts the caller's own routine on a live session", async () => {
      const own = await prisma.routine.create({ data: { userId, name: 'Rutina propia' } });

      await withOpenSession(async (sessionId) => {
        const res = await request(app)
          .patch(`/api/workouts/${sessionId}`)
          .set('Cookie', [`auth_token=${authToken}`])
          .send({ routineId: own.id, notes: 'buenas' });

        expect(res.status).toBe(200);
        expect(res.body.data.routineId).toBe(own.id);
        expect(res.body.data.notes).toBe('buenas');
      });
    });
  });

  // Finishing is the one write on a session that a finished session must ACCEPT. Every
  // other route in this file answers 409 there; this one answers 200 and changes
  // nothing, because the second tap of an undebounced button is not an error and the
  // client's catch cannot tell a 409 apart from a dead network.
  describe('POST /api/workouts/:id/finish', () => {
    it('answers 200 and leaves finishedAt untouched when the session is already finished', async () => {
      const finishedAt = new Date(Date.now() - 60 * 60 * 1000);
      const session = await prisma.workoutSession.create({
        data: { userId, startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), finishedAt },
      });

      try {
        const res = await request(app)
          .post(`/api/workouts/${session.id}/finish`)
          .set('Cookie', [`auth_token=${authToken}`]);

        expect(res.status).toBe(200);
        expect(new Date(res.body.data.finishedAt)).toEqual(finishedAt);

        const stored = await prisma.workoutSession.findUnique({ where: { id: session.id } });
        expect(stored?.finishedAt).toEqual(finishedAt);
      } finally {
        // deleteMany, not delete: a mutation that wrongly discards this row makes the
        // cleanup throw P2025, and that exception REPLACES the assertion above in the
        // report — the row-survival guarantee would then be "covered" by a crash in a
        // finally block. Measured: that is exactly what happened.
        await prisma.workoutSession.deleteMany({ where: { id: session.id } });
      }
    });

    // Item 9: this used to reach the generic handler as a 500, which tells the client
    // "server is broken, retry" about an id that will never resolve.
    it('answers 404 for a session id that does not exist', async () => {
      const res = await request(app)
        .post('/api/workouts/00000000-0000-0000-0000-000000000000/finish')
        .set('Cookie', [`auth_token=${authToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Session not found');
    });

    // Parametrized over the foreign session's state because the OPEN case alone cannot
    // pin the order: were state read before ownership, a foreign FINISHED session would
    // take the idempotent path and return another user's row as a 200.
    it.each([
      ['OPEN', null],
      ['FINISHED', new Date()],
    ] as const)("answers 404 for another user's session, %s", async (_label, finishedAt) => {
      const other = await prisma.user.create({
        data: {
          email: `route.finish.other.${Date.now()}.${Math.random()}@example.com`,
          password: 'password123',
          name: 'Other',
        },
      });
      try {
        const foreign = await prisma.workoutSession.create({
          data: { userId: other.id, startedAt: new Date(Date.now() - 60_000), finishedAt },
        });

        const res = await request(app)
          .post(`/api/workouts/${foreign.id}/finish`)
          .set('Cookie', [`auth_token=${authToken}`]);

        expect(res.status).toBe(404);
        // Byte-identical to the answer for an id that does not exist, or the difference
        // confirms the id to anyone enumerating uuids.
        expect(res.body.error.message).toBe('Session not found');

        const stored = await prisma.workoutSession.findUnique({ where: { id: foreign.id } });
        expect(stored?.finishedAt).toEqual(finishedAt);
      } finally {
        await prisma.workoutSession.deleteMany({ where: { userId: other.id } });
        await prisma.user.delete({ where: { id: other.id } });
      }
    });

    // The rethrow is not decoration. `respondToSessionWriteError` owns only the
    // sentinels, so without `throw err` a genuine fault leaves the catch having sent
    // NOTHING — the request hangs until the client's own timeout, which is worse than
    // the 500 it replaced. Found by mutation: every other test here passed without it.
    it('lets a non-sentinel failure surface as 500 instead of hanging', async () => {
      const boom = vi.spyOn(workoutService, 'finishWorkout').mockRejectedValueOnce(new Error('DB_EXPLODED'));
      try {
        await withOpenSession(async (sessionId) => {
          const res = await request(app)
            .post(`/api/workouts/${sessionId}/finish`)
            .set('Cookie', [`auth_token=${authToken}`]);

          expect(res.status).toBe(500);
        });
      } finally {
        boom.mockRestore();
      }
    });

    // The counterweight: the guards must not refuse the case the route exists for.
    // The set is not decoration: a session with zero sets is DISCARDED now, so without
    // it this fixture would stop testing the close path and start testing the discard.
    it('finishes an open session', async () => {
      await withOpenSession(async (sessionId) => {
        await prisma.workoutSet.create({
          data: { sessionId, exerciseId, setNumber: 1, weightKg: 60, reps: 8 },
        });

        const res = await request(app)
          .post(`/api/workouts/${sessionId}/finish`)
          .set('Cookie', [`auth_token=${authToken}`]);

        expect(res.status).toBe(200);
        expect(res.body.data.finishedAt).not.toBeNull();
      });
    });

    // Tapping Start and walking back is not "I finished a workout" — it is a session
    // that never happened. `finishWorkout` was the last live producer of empty closed
    // rows: the stale sweep and startWorkout step 5 already delete them, and every
    // read (history, progress, dashboard, rotation) already refuses to count them.
    //
    // The row is returned as it was, with `finishedAt` still null, and the client is
    // untouched by design: `handleFinish` awaits the call and discards the body —
    // measured on `page.tsx:100`, it is the only caller.
    describe('discards a session that logged nothing', () => {
      // Cannot use `withOpenSession`: its cleanup deletes the row by id, which throws
      // P2025 once the route under test has already deleted it.
      const withDiscardableSession = async (fn: (sessionId: string) => Promise<void>) => {
        const session = await prisma.workoutSession.create({
          data: { userId, startedAt: new Date(), finishedAt: null },
        });
        try {
          await fn(session.id);
        } finally {
          await prisma.workoutSet.deleteMany({ where: { sessionId: session.id } });
          await prisma.workoutSessionExercise.deleteMany({ where: { sessionId: session.id } });
          await prisma.workoutSession.deleteMany({ where: { id: session.id } });
        }
      };

      // G1 + G2 together: the row is gone, and the answer keeps the shape every caller
      // already gets. Asserting only the status would pass against a 200 with no body.
      it('deletes the row and still answers 200 with it', async () => {
        await withDiscardableSession(async (sessionId) => {
          const res = await request(app)
            .post(`/api/workouts/${sessionId}/finish`)
            .set('Cookie', [`auth_token=${authToken}`]);

          expect(res.status).toBe(200);
          expect(res.body.data.id).toBe(sessionId);

          const stored = await prisma.workoutSession.findUnique({ where: { id: sessionId } });
          expect(stored).toBeNull();
        });
      });

      // Measured on the real database before this change: the 10 empty closed rows had
      // 18 exercise links hanging off them — people opened exercises and logged nothing.
      // Those links are the session's plan; a session that does not exist has no plan,
      // so `onDelete: Cascade` taking them is the wanted outcome, not a side effect.
      it('takes the exercise links with it when nothing was logged', async () => {
        await withDiscardableSession(async (sessionId) => {
          await prisma.workoutSessionExercise.create({
            data: { sessionId, exerciseId, order: 0 },
          });

          const res = await request(app)
            .post(`/api/workouts/${sessionId}/finish`)
            .set('Cookie', [`auth_token=${authToken}`]);

          expect(res.status).toBe(200);

          const links = await prisma.workoutSessionExercise.count({ where: { sessionId } });
          expect(links).toBe(0);
          const stored = await prisma.workoutSession.findUnique({ where: { id: sessionId } });
          expect(stored).toBeNull();
        });
      });

      // G5. The discard is for a session being finished, never for one that already is:
      // history is not re-judged by a second tap. Dedicated because the mutation matrix
      // measured that dropping `finishedAt: null` from the delete killed exactly ONE
      // test, and it died on a P2025 thrown by its own cleanup — a crash in a finally
      // block is not a guard. This one asserts the row survives and cleans up with
      // deleteMany, so the assertion is what fails.
      //
      // After this change nothing in the codebase can create a finished-and-empty row
      // (the sweep and step 5 delete empties, the shared helper needs sets, PATCH cannot
      // write finishedAt, and the migration removed the historical ones), so the fixture
      // writes the state directly. The predicate stays because it costs nothing and any
      // future writer that closes without deleting would need it.
      it('leaves an already-finished session alone even when it has no sets', async () => {
        const finishedAt = new Date(Date.now() - 60 * 60 * 1000);
        const session = await prisma.workoutSession.create({
          data: { userId, startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), finishedAt },
        });

        try {
          const res = await request(app)
            .post(`/api/workouts/${session.id}/finish`)
            .set('Cookie', [`auth_token=${authToken}`]);

          expect(res.status).toBe(200);

          const stored = await prisma.workoutSession.findUnique({ where: { id: session.id } });
          expect(stored).not.toBeNull();
          expect(stored!.finishedAt).toEqual(finishedAt);
        } finally {
          await prisma.workoutSession.deleteMany({ where: { id: session.id } });
        }
      });

      // G3, the counterweight that decides the whole change: ONE set is training data,
      // and training data is never destroyed by a button labelled "finish". This is also
      // the write-time re-check (G4) — the predicate lives in the delete's WHERE, so a
      // set that exists when the statement runs makes it match nothing.
      it('closes, never deletes, a session that logged even one set', async () => {
        await withDiscardableSession(async (sessionId) => {
          await prisma.workoutSet.create({
            data: { sessionId, exerciseId, setNumber: 1, weightKg: 40, reps: 12 },
          });

          const res = await request(app)
            .post(`/api/workouts/${sessionId}/finish`)
            .set('Cookie', [`auth_token=${authToken}`]);

          expect(res.status).toBe(200);
          expect(res.body.data.finishedAt).not.toBeNull();

          const stored = await prisma.workoutSession.findUnique({ where: { id: sessionId } });
          expect(stored?.finishedAt).not.toBeNull();
        });
      });
    });
  });

  // `StartWorkoutSchema`
  // declared `notes`, validated its type — measured: `{ notes: 12345 }` is a 400 —
  // and then the route destructured it and never passed it on. Accepting a field and
  // dropping it is the one answer that is definitely wrong, so the choice is honour
  // or reject, and honouring it cannot be done without reintroducing the resume's shape:
  // a start that RESUMES has no new row to write the note onto, leaving only "write
  // it over the live session's notes" (a start silently editing existing user data)
  // or "drop it again" (the same hidden-state asymmetry, inside its own fix).
  //
  // Rejecting needs `.strict()`, not just deleting the key: measured on main, a
  // z.object silently strips unknown keys, so removing `notes` from the schema would
  // have changed nothing observable. Safe because no caller sends it — the frontend's
  // `startWorkout` takes a `notes` argument that both of its call sites pass as
  // `undefined`, and JSON.stringify drops undefined keys, so the wire body never
  // carried it. That dead argument is removed in the same change, because after this
  // guard it stops being harmless and becomes a guaranteed 400.
  describe('POST /api/workouts/start body validation', () => {
    // These two assert that NO session was created. When the assertion fails the
    // session exists anyway, and one open session per user is all the partial index
    // allows — so without this sweep a red here takes every later create in the file
    // down with an unrelated P2002 (observed while proving the red).
    const expectStartRejected = async (body: Record<string, unknown>) => {
      const before = await prisma.workoutSession.count({ where: { userId } });
      try {
        const res = await request(app)
          .post('/api/workouts/start')
          .set('Cookie', [`auth_token=${authToken}`])
          .send(body);

        expect(res.status).toBe(400);
        // Rejected before the service ran: no sweep, no close, no create.
        expect(await prisma.workoutSession.count({ where: { userId } })).toBe(before);
      } finally {
        const leaked = await prisma.workoutSession.findMany({
          where: { userId, finishedAt: null },
          select: { id: true },
        });
        const ids = leaked.map((s) => s.id);
        await prisma.workoutSet.deleteMany({ where: { sessionId: { in: ids } } });
        await prisma.workoutSessionExercise.deleteMany({ where: { sessionId: { in: ids } } });
        await prisma.workoutSession.deleteMany({ where: { id: { in: ids } } });
      }
    };

    // G6 + G7.
    it('rejects notes instead of accepting and discarding it', async () => {
      await expectStartRejected({ notes: 'mi nota' });
    });

    // G9. The mechanism is what makes the guarantee total: `notes` was only the key
    // someone noticed. Any unrecognized key was parsed away in silence, so a client
    // typo in `routineId` started a workout with no routine and reported success.
    it('rejects any unrecognized key rather than stripping it', async () => {
      await expectStartRejected({ routineIdd: '00000000-0000-0000-0000-000000000000' });
    });
  });

  // This route validated
  // with a bare `if (!exerciseId)` while its sibling `POST /:id/sets` uses Zod with
  // `z.string().uuid()`, so anything truthy went straight into a Prisma call.
  //
  // Measured on main 2026-07-29 against an OPEN session, because the open-session guard
  // masks all of this on a closed one: `"not-a-uuid"` is a 500 carrying a
  // PrismaClientKnownRequestError (the string reached Postgres and failed the uuid
  // cast) and `{"contains":"x"}`, `{"not":null}` and `[uuid]` are 500s carrying a
  // PrismaClientValidationError.
  //
  // The filter-injection reading of that object payload was CHECKED AND REFUTED, not
  // assumed: `exerciseId` only ever lands in the `sessionId_exerciseId` compound
  // unique of a findUnique/upsert, and a compound unique input takes a scalar String,
  // so Prisma rejects the object client-side before any SQL. Probed directly with
  // `contains`, `startsWith` and `not` in that position — all three threw
  // PrismaClientValidationError, none returned a row, and no junk link was written.
  // (A plain `where: { exerciseId: { contains } }` IS filterable and was confirmed to
  // work — that position simply never receives this input.) So the severity stays
  // BAJO: a 500 where a 400 belongs, not a way to read another row.
  describe('POST /api/workouts/:id/exercises input validation', () => {
    // G10 + G11 + G15-adjacent. The array and object cases are the ones that reached
    // Prisma as non-strings; the plain string is the one that reached Postgres.
    it.each([
      ['non-uuid string', 'not-a-uuid'],
      ['filter-shaped object', { contains: 'x' }],
      ['negation-shaped object', { not: null }],
      ['array', ['00000000-0000-0000-0000-000000000000']],
      ['number', 12345],
    ] as const)('answers 400, not 500, for a %s exerciseId', async (_label, value) => {
      await withOpenSession(async (sessionId) => {
        const res = await request(app)
          .post(`/api/workouts/${sessionId}/exercises`)
          .set('Cookie', [`auth_token=${authToken}`])
          .send({ exerciseId: value });

        expect(res.status).toBe(400);
        expect(await prisma.workoutSessionExercise.count({ where: { sessionId } })).toBe(0);
      });
    });

    // G13. The one case the bare guard did cover has to survive the rewrite.
    it('answers 400 when exerciseId is missing', async () => {
      await withOpenSession(async (sessionId) => {
        const res = await request(app)
          .post(`/api/workouts/${sessionId}/exercises`)
          .set('Cookie', [`auth_token=${authToken}`])
          .send({});

        expect(res.status).toBe(400);
      });
    });

    // G12. Where the body is checked relative to the session's state, pinned on the
    // one combination that can tell the difference. On main this answered 409, because
    // the open-session guard fires inside the service before Prisma ever sees the bad id —
    // which is why this defect could only be reproduced on an open session at all. The
    // body is now parsed at the route like every sibling here does, so a malformed
    // request is malformed whatever the session is doing.
    it('answers 400 for a malformed exerciseId even when the session is finished', async () => {
      const closed = await prisma.workoutSession.create({
        data: { userId, startedAt: new Date(Date.now() - 60_000), finishedAt: new Date() },
      });

      try {
        const res = await request(app)
          .post(`/api/workouts/${closed.id}/exercises`)
          .set('Cookie', [`auth_token=${authToken}`])
          .send({ exerciseId: 'not-a-uuid' });

        expect(res.status).toBe(400);
      } finally {
        await prisma.workoutSession.delete({ where: { id: closed.id } });
      }
    });

    // G14, the counterweight: a schema tight enough to reject every payload above must
    // still accept the one the route exists for. Passes on main — its proof is the
    // mutation that swaps `.uuid()` for another id format, not a prior red.
    it('links the exercise for a valid uuid on an open session', async () => {
      await withOpenSession(async (sessionId) => {
        const res = await request(app)
          .post(`/api/workouts/${sessionId}/exercises`)
          .set('Cookie', [`auth_token=${authToken}`])
          .send({ exerciseId });

        expect(res.status).toBe(201);
        expect(res.body.data.exerciseId).toBe(exerciseId);
      });
    });
  });

  // A session with no sets
  // is not a workout, and this route returned them anyway. Its only caller,
  // `RoutineProgressSheet`, renders every returned row as a history entry
  // ("0 series completadas") AND as a point on the volume chart — so each empty row
  // is both a junk line and a fake dip to zero in the user's progress.
  //
  // The route is where this closes rather than the writers, because the writers are
  // not one place. PR #20 stopped `startWorkout`'s step 5 and the stale sweep from
  // producing them (both DELETE an empty session now), but `finishWorkout` still
  // does: measured 2026-07-29, starting a workout and tapping Finalizar without
  // logging anything leaves finishedAt set, notes null and zero sets. That path is a
  // deliberate user action returning its own row to the client, so it is left alone
  // on purpose — which means any fix that lives in a writer would be incomplete by
  // construction. Filtering on read is source-agnostic: it does not matter who wrote
  // the row or when.
  //
  // Fixtures are built with plain creates rather than through `finishWorkout`, so the
  // filter stays pinned to the SHAPE of the row (zero sets) and not to whichever code
  // path happens to produce that shape today.
  describe('GET /api/workouts/sessions', () => {
    let historyRoutineId: string;
    let sessionWithSetsId: string;
    let emptyClosedId: string;
    let emptyClosedNoRoutineId: string;

    beforeAll(async () => {
      const routine = await prisma.routine.create({
        data: { userId, name: `Historial ${Date.now()}` },
      });
      historyRoutineId = routine.id;

      const withSets = await prisma.workoutSession.create({
        data: {
          userId,
          routineId: historyRoutineId,
          startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
          finishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });
      sessionWithSetsId = withSets.id;
      await prisma.workoutSet.create({
        data: { sessionId: withSets.id, exerciseId, setNumber: 1, weightKg: 80, reps: 5 },
      });

      // Exactly what `finishWorkout` leaves behind on a workout where nothing was
      // logged: finished, no marker note, zero sets. It also carries the plan
      // snapshot links, because `createSessionWithPlan` writes those at start —
      // measured on all 10 such rows in the dev database.
      const empty = await prisma.workoutSession.create({
        data: {
          userId,
          routineId: historyRoutineId,
          startedAt: new Date(Date.now() - 90 * 60 * 1000),
          finishedAt: new Date(Date.now() - 89 * 60 * 1000),
        },
      });
      emptyClosedId = empty.id;
      await prisma.workoutSessionExercise.create({
        data: { sessionId: empty.id, exerciseId, order: 0 },
      });

      // A start with no routine attached: unreachable through the ?routineId= query,
      // so only the unscoped list can catch it.
      const emptyNoRoutine = await prisma.workoutSession.create({
        data: {
          userId,
          startedAt: new Date(Date.now() - 80 * 60 * 1000),
          finishedAt: new Date(Date.now() - 79 * 60 * 1000),
        },
      });
      emptyClosedNoRoutineId = emptyNoRoutine.id;
    });

    afterAll(async () => {
      await prisma.workoutSet.deleteMany({ where: { sessionId: sessionWithSetsId } });
      await prisma.workoutSessionExercise.deleteMany({ where: { sessionId: emptyClosedId } });
      await prisma.workoutSession.deleteMany({
        where: { id: { in: [sessionWithSetsId, emptyClosedId, emptyClosedNoRoutineId] } },
      });
      await prisma.routine.deleteMany({ where: { id: historyRoutineId } });
    });

    // G1 + G2, on the population this route's only caller actually requests.
    it('leaves an empty session out of a routine history and keeps the one with sets', async () => {
      const res = await request(app)
        .get(`/api/workouts/sessions?routineId=${historyRoutineId}`)
        .set('Cookie', [`auth_token=${authToken}`]);

      expect(res.status).toBe(200);
      const ids = res.body.data.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(emptyClosedId);
      // The counterweight, in the same assertion pair: a filter that empties the
      // history satisfies the line above and destroys the feature.
      expect(ids).toContain(sessionWithSetsId);
      expect(ids).toHaveLength(1);
    });

    // G3. `total` feeds `hasMore` and `pageCount`, so counting a population the
    // client can never page to is its own bug: the sheet would be told there are
    // more workouts behind a page that will always come back short.
    it('counts the same population it returns', async () => {
      const res = await request(app)
        .get(`/api/workouts/sessions?routineId=${historyRoutineId}`)
        .set('Cookie', [`auth_token=${authToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(1);
      expect(res.body.pagination.hasMore).toBe(false);
      expect(res.body.pagination.pageCount).toBe(1);
    });

    // G1 again, unscoped — the empty row with no routine is invisible to the query
    // above, and this is the shape the route returns when the sheet is opened for a
    // user whose junk predates any routine.
    it('returns no set-less session at all in the unscoped history', async () => {
      const res = await request(app)
        .get('/api/workouts/sessions')
        .set('Cookie', [`auth_token=${authToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      const ids = res.body.data.map((s: { id: string }) => s.id);
      expect(ids).not.toContain(emptyClosedNoRoutineId);
      expect(ids).not.toContain(emptyClosedId);
      expect(ids).toContain(sessionWithSetsId);
      // The invariant itself, not just the fixtures: nothing in this response may
      // carry an empty `sets` array, whoever wrote it.
      const emptyRows = res.body.data.filter(
        (s: { sets: unknown[] }) => s.sets.length === 0
      );
      expect(emptyRows).toEqual([]);
    });

    // The one row a user could plausibly be looking at right now. An in-progress
    // workout with nothing logged yet is not history either, and the same filter has
    // to reach it — otherwise "empty" would silently mean "empty and finished".
    it('leaves an open session with no sets out too', async () => {
      const open = await prisma.workoutSession.create({
        data: { userId, routineId: historyRoutineId, startedAt: new Date(), finishedAt: null },
      });

      try {
        const res = await request(app)
          .get(`/api/workouts/sessions?routineId=${historyRoutineId}`)
          .set('Cookie', [`auth_token=${authToken}`]);

        expect(res.status).toBe(200);
        const ids = res.body.data.map((s: { id: string }) => s.id);
        expect(ids).not.toContain(open.id);
        expect(ids).toEqual([sessionWithSetsId]);
      } finally {
        // The partial unique index allows one open session per user; leaving this
        // one behind kills the next create in this file with an unrelated P2002.
        await prisma.workoutSession.delete({ where: { id: open.id } });
      }
    });

    // G5. The filter is a new key on the same WHERE object that carries the tenant
    // scope; replacing that object rather than extending it would hand another
    // user's workouts to this caller, and every row in this response is rendered.
    it("never returns another user's session, sets or not", async () => {
      const other = await prisma.user.create({
        data: {
          email: `route.history.other.${Date.now()}.${Math.random()}@example.com`,
          password: 'password123',
          name: 'Other',
        },
      });

      try {
        const foreign = await prisma.workoutSession.create({
          data: {
            userId: other.id,
            startedAt: new Date(Date.now() - 60_000),
            finishedAt: new Date(),
          },
        });
        await prisma.workoutSet.create({
          data: { sessionId: foreign.id, exerciseId, setNumber: 1, weightKg: 60, reps: 10 },
        });

        const res = await request(app)
          .get('/api/workouts/sessions')
          .set('Cookie', [`auth_token=${authToken}`]);

        expect(res.status).toBe(200);
        const ids = res.body.data.map((s: { id: string }) => s.id);
        expect(ids).not.toContain(foreign.id);
      } finally {
        await prisma.workoutSet.deleteMany({ where: { session: { userId: other.id } } });
        await prisma.workoutSession.deleteMany({ where: { userId: other.id } });
        await prisma.user.delete({ where: { id: other.id } });
      }
    });
  });
});
