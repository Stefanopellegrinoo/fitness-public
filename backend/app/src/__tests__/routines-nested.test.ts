import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

describe('Routines CRUD (nested contract)', () => {
  let userId: string;
  let authToken: string;
  let exerciseA: string;
  let exerciseB: string;
  let routineId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `routine.nested.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    const [a, b] = await Promise.all([
      prisma.exercise.create({ data: { name: `Nested A ${Date.now()}`, category: 'PECHO' } }),
      prisma.exercise.create({ data: { name: `Nested B ${Date.now()}`, category: 'ESPALDA' } }),
    ]);
    exerciseA = a.id;
    exerciseB = b.id;
  });

  afterAll(async () => {
    await prisma.routine.deleteMany({ where: { userId } });
    await prisma.exercise.deleteMany({ where: { id: { in: [exerciseA, exerciseB] } } });
    await prisma.user.delete({ where: { id: userId } });
  });

  function nestedPayload() {
    return {
      name: 'Nested PPL',
      days: [
        {
          name: 'Push A', order: 1, weekday: 'LUNES',
          exercises: [{
            exerciseId: exerciseA, order: 0, restSeconds: 120, notes: 'pausa en el pecho',
            setPlans: [
              { order: 1, setType: 'WARMUP', repsMin: 8, repsMax: 8, percentOfTopSet: 50 },
              { order: 2, setType: 'TOP', repsMin: 4, repsMax: 6, targetRpe: 9, restSeconds: 180 },
              { order: 3, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 90 },
            ],
          }],
        },
        {
          name: 'Pull A', order: 2,
          exercises: [{ exerciseId: exerciseB, order: 0, setPlans: [] }],
        },
      ],
    };
  }

  it('POST /api/routines creates days, exercises and set plans; response includes ordered days', async () => {
    const res = await request(app)
      .post('/api/routines')
      .set('Cookie', [`auth_token=${authToken}`])
      .send(nestedPayload());
    expect(res.status).toBe(201);
    routineId = res.body.data.id;
    expect(res.body.data.days).toHaveLength(2);
    expect(res.body.data.days[0].name).toBe('Push A');
    expect(res.body.data.days[0].exercises[0].setPlans).toHaveLength(3);
    expect(res.body.data.days[0].exercises[0].setPlans[1]).toMatchObject({ setType: 'TOP', repsMin: 4, repsMax: 6 });
    // legacy dual-write: flat exercises[] still present for the old frontend
    expect(res.body.data.exercises).toHaveLength(2);
  });

  it('POST rejects the old flat payload with 400', async () => {
    const res = await request(app)
      .post('/api/routines')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ name: 'Old flat', exercises: [{ exerciseId: exerciseA, order: 0, targetSets: 3, targetReps: '8-12' }] });
    expect(res.status).toBe(400);
  });

  it('GET /api/routines/:id returns days -> exercises -> setPlans ordered', async () => {
    const res = await request(app)
      .get(`/api/routines/${routineId}`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data.days.map((d: any) => d.order)).toEqual([1, 2]);
    expect(res.body.data.days[0].exercises[0].setPlans.map((p: any) => p.order)).toEqual([1, 2, 3]);
  });

  it('PUT /api/routines/:id full-replaces days and set plans', async () => {
    const res = await request(app)
      .put(`/api/routines/${routineId}`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({
        name: 'Nested PPL v2',
        days: [{
          name: 'Full Body', order: 1,
          exercises: [{
            exerciseId: exerciseB, order: 0,
            setPlans: [{ order: 1, setType: 'AMRAP', repsMin: 8 }],
          }],
        }],
      });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Nested PPL v2');
    expect(res.body.data.days).toHaveLength(1);
    expect(res.body.data.days[0].exercises[0].setPlans[0].setType).toBe('AMRAP');
    const planCount = await prisma.routineSetPlan.count({
      where: { routineExercise: { routineId } }
    });
    expect(planCount).toBe(1); // old plans gone
  });

  it('dual-writes legacy fields (dayOfWeek, targetSets, targetReps, targetRpe) from the nested day/setPlans', async () => {
    const res = await request(app)
      .post('/api/routines')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({
        name: 'Legacy Dual Write',
        days: [
          {
            name: 'Push Legacy', order: 1, weekday: 'LUNES',
            exercises: [{
              exerciseId: exerciseA, order: 0,
              setPlans: [
                { order: 1, setType: 'WARMUP', repsMin: 10, repsMax: 10 },
                { order: 2, setType: 'WORKING', repsMin: 6, repsMax: 8, targetRpe: 8 },
                { order: 3, setType: 'WORKING', repsMin: 6, repsMax: 8, targetRpe: 8 },
              ],
            }],
          },
        ],
      });
    expect(res.status).toBe(201);
    const legacyRoutineId = res.body.data.id;

    const routineExercise = await prisma.routineExercise.findFirstOrThrow({
      where: { routineId: legacyRoutineId, exerciseId: exerciseA },
    });
    expect(routineExercise.dayOfWeek).toBe('LUNES');
    expect(routineExercise.targetSets).toBe(2);
    expect(routineExercise.targetReps).toBe('6-8');
    expect(routineExercise.targetRpe).toBe(8);

    await prisma.routine.delete({ where: { id: legacyRoutineId } });
  });

  it('DELETE cascades days, exercises and set plans', async () => {
    const res = await request(app)
      .delete(`/api/routines/${routineId}`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(await prisma.routineDay.count({ where: { routineId } })).toBe(0);
    expect(await prisma.routineExercise.count({ where: { routineId } })).toBe(0);
  });
});
