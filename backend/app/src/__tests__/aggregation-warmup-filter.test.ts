import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

describe('Aggregations exclude warmups', () => {
  let userId: string;
  let authToken: string;
  let exerciseId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `warmupfilter.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    const exercise = await prisma.exercise.create({
      data: { name: `WarmupFilter ${Date.now()}`, category: 'PECHO', primaryMuscles: ['pecho'] }
    });
    exerciseId = exercise.id;

    const session = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date(), finishedAt: new Date() }
    });
    await prisma.workoutSet.createMany({
      data: [
        { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 100, reps: 10, setType: 'WARMUP', isWarmup: true, rpe: null },
        { sessionId: session.id, exerciseId, setNumber: 2, weightKg: 80, reps: 10, setType: 'WORKING', rpe: 8 },
      ]
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.routine.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('GET /api/progress/workouts volume excludes warmup sets', async () => {
    const res = await request(app)
      .get('/api/progress/workouts?weeks=1')
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data[0].volume).toBe(80 * 10); // warmup 100x10 excluded
  });

  it('GET /api/dashboard/stats/volume excludes warmup sets', async () => {
    const res = await request(app)
      .get('/api/dashboard/stats/volume')
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data['PECHO'].current).toBe(80 * 10);
  });

  it('GET /api/dashboard nextWorkout counts exercises across days', async () => {
    const routine = await prisma.routine.create({ data: { name: 'Dash Routine', userId } });
    const day = await prisma.routineDay.create({
      data: { routineId: routine.id, name: 'Día 1', order: 1 }
    });
    await prisma.routineExercise.create({
      data: { routineId: routine.id, dayId: day.id, exerciseId, order: 0 }
    });
    const res = await request(app)
      .get('/api/dashboard')
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data.nextWorkout.exercisesCount).toBe(1);
  });

  it('GET /api/workouts/history/exercise/:exerciseId returns exact setType and rpe per set', async () => {
    const res = await request(app)
      .get(`/api/workouts/history/exercise/${exerciseId}`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);

    // Match by setNumber instead of relying on response order.
    const sets: Array<{ setNumber: number; setType: string; rpe: number | null }> = res.body.data;
    const warmupSet = sets.find((s) => s.setNumber === 1);
    const workingSet = sets.find((s) => s.setNumber === 2);

    expect(warmupSet).toBeDefined();
    expect(warmupSet?.setType).toBe('WARMUP');
    expect(warmupSet?.rpe).toBeNull();

    expect(workingSet).toBeDefined();
    expect(workingSet?.setType).toBe('WORKING');
    expect(workingSet?.rpe).toBe(8);
  });
});
