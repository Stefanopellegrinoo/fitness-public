import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

describe('startWorkout + addWorkoutSet (characterization)', () => {
  let userId: string;
  let authToken: string;
  let exMonday: string;
  let exNoDay: string;
  let exWednesday: string;
  let routineId: string;
  let wedOnlyRoutineId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `workout.char.${Date.now()}@example.com`, password: 'password123', name: 'Workout Char' }
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;

    const [e1, e2, e3] = await Promise.all([
      prisma.exercise.create({ data: { name: `Char Monday ${Date.now()}`, category: 'PECHO' } }),
      prisma.exercise.create({ data: { name: `Char NoDay ${Date.now()}`, category: 'ESPALDA' } }),
      prisma.exercise.create({ data: { name: `Char Wed ${Date.now()}`, category: 'PIERNAS' } }),
    ]);
    exMonday = e1.id; exNoDay = e2.id; exWednesday = e3.id;

    const routine = await prisma.routine.create({
      data: {
        name: 'Char Multi', userId,
        exercises: {
          create: [
            { exerciseId: exMonday, order: 0, targetSets: 3, targetReps: '8-12', dayOfWeek: 'LUNES' },
            { exerciseId: exNoDay, order: 1, targetSets: 2, targetReps: '10', dayOfWeek: null },
          ]
        }
      }
    });
    routineId = routine.id;

    const wedRoutine = await prisma.routine.create({
      data: {
        name: 'Char WedOnly', userId,
        exercises: { create: [{ exerciseId: exWednesday, order: 0, targetSets: 3, targetReps: '8-12', dayOfWeek: 'MIERCOLES' }] }
      }
    });
    wedOnlyRoutineId = wedRoutine.id;
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSessionExercise.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.routine.deleteMany({ where: { userId } });
    await prisma.exercise.deleteMany({ where: { id: { in: [exMonday, exNoDay, exWednesday] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function finishActive() {
    const active = await prisma.workoutSession.findFirst({ where: { userId, finishedAt: null } });
    if (active) {
      await prisma.workoutSession.update({ where: { id: active.id }, data: { finishedAt: new Date() } });
    }
  }

  // CUTOVER (Task 10): legacy flat routines (no RoutineDay rows) prefill nothing
  it('start on a routine without days creates a session with no prefilled exercises', async () => {
    const res = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId: wedOnlyRoutineId, clientDay: 'VIERNES' });
    expect(res.status).toBe(201);
    expect(res.body.data.exercises).toHaveLength(0);
    expect(res.body.data.routineDayId).toBeNull();
    await finishActive();
  });

  // STABLE: resume semantics must survive the rewrite
  it('starting again with the same routine resumes the active session', async () => {
    const first = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId, clientDay: 'LUNES' });
    const second = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId, clientDay: 'LUNES' });
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  // STABLE: finished sessions are history — starting again creates a new one
  it('starting after finishing today creates a new session and preserves the finished one', async () => {
    const active = await prisma.workoutSession.findFirst({ where: { userId, finishedAt: null } });
    const originalStartedAt = active!.startedAt;
    // Logged set: finishing a session with none DISCARDS it, and "preserves the finished
    // one" would have nothing left to preserve.
    await prisma.workoutSet.create({
      data: { sessionId: active!.id, exerciseId: exMonday, setNumber: 1, weightKg: 60, reps: 10 },
    });
    await request(app)
      .post(`/api/workouts/${active!.id}/finish`)
      .set('Cookie', [`auth_token=${authToken}`]);
    const res = await request(app)
      .post('/api/workouts/start')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ routineId, clientDay: 'LUNES' });
    expect(res.body.data.id).not.toBe(active!.id);
    expect(res.body.data.finishedAt).toBeNull();
    // The finished session keeps its original startedAt/finishedAt — history is never rewritten.
    const finished = await prisma.workoutSession.findUnique({ where: { id: active!.id } });
    expect(finished!.startedAt.getTime()).toBe(originalStartedAt.getTime());
    expect(finished!.finishedAt).not.toBeNull();
  });

  // STABLE: upsert prevents duplicate set numbers
  it('POST /:id/sets twice with the same setNumber updates instead of duplicating', async () => {
    const active = await prisma.workoutSession.findFirst({ where: { userId, finishedAt: null } });
    const base = { exerciseId: exMonday, setNumber: 1, weightKg: 60, reps: 10 };
    await request(app)
      .post(`/api/workouts/${active!.id}/sets`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send(base);
    const second = await request(app)
      .post(`/api/workouts/${active!.id}/sets`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ ...base, weightKg: 62.5 });
    expect(second.status).toBe(201);
    const count = await prisma.workoutSet.count({ where: { sessionId: active!.id, exerciseId: exMonday, setNumber: 1 } });
    expect(count).toBe(1);
    expect(second.body.data.weightKg).toBe(62.5);
  });

  // CUTOVER-SENSITIVE: isWarmup upsert semantics.
  // Pinned reality: WorkoutSetSchema's .transform() (workouts.routes.ts) always computes and emits
  // BOTH setType and isWarmup explicitly on every POST — isWarmup is derived from setType, never
  // passed through raw. So when isWarmup is omitted, the transform still resolves setType to
  // WORKING and isWarmup to `false` explicitly, not undefined. Prisma therefore does NOT no-op the
  // field; it overwrites a previously-true value back to false on the very next upsert that omits it.
  it('logging isWarmup:true then upserting the same set without isWarmup resets it to false', async () => {
    const active = await prisma.workoutSession.findFirst({ where: { userId, finishedAt: null } });
    const base = { exerciseId: exMonday, setNumber: 2, weightKg: 40, reps: 12 };

    const first = await request(app)
      .post(`/api/workouts/${active!.id}/sets`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ ...base, isWarmup: true });
    expect(first.status).toBe(201);
    expect(first.body.data.isWarmup).toBe(true);

    const second = await request(app)
      .post(`/api/workouts/${active!.id}/sets`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send(base); // isWarmup omitted from the payload
    expect(second.status).toBe(201);
    expect(second.body.data.isWarmup).toBe(false);

    const stored = await prisma.workoutSet.findUnique({
      where: { sessionId_exerciseId_setNumber: { sessionId: active!.id, exerciseId: exMonday, setNumber: 2 } }
    });
    expect(stored?.isWarmup).toBe(false);
  });
});
