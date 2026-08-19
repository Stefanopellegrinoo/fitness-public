import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

describe('WorkoutSet setType', () => {
  let userId: string;
  let authToken: string;
  let exerciseId: string;
  let sessionId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `settype.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    const exercise = await prisma.exercise.create({ data: { name: `SetType ${Date.now()}`, category: 'PECHO' } });
    exerciseId = exercise.id;
    const session = await prisma.workoutSession.create({ data: { userId } });
    sessionId = session.id;
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { sessionId } });
    await prisma.workoutSessionExercise.deleteMany({ where: { sessionId } });
    await prisma.workoutSession.delete({ where: { id: sessionId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('records an explicit setType and syncs isWarmup', async () => {
    const res = await request(app)
      .post(`/api/workouts/${sessionId}/sets`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ exerciseId, setNumber: 1, weightKg: 100, reps: 5, setType: 'TOP' });
    expect(res.status).toBe(201);
    expect(res.body.data.setType).toBe('TOP');
    expect(res.body.data.isWarmup).toBe(false);
  });

  it('maps legacy isWarmup:true to WARMUP when setType is absent', async () => {
    const res = await request(app)
      .post(`/api/workouts/${sessionId}/sets`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ exerciseId, setNumber: 2, weightKg: 40, reps: 10, isWarmup: true });
    expect(res.status).toBe(201);
    expect(res.body.data.setType).toBe('WARMUP');
    expect(res.body.data.isWarmup).toBe(true);
  });

  it('defaults to WORKING when neither field is sent', async () => {
    const res = await request(app)
      .post(`/api/workouts/${sessionId}/sets`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ exerciseId, setNumber: 3, weightKg: 80, reps: 8 });
    expect(res.status).toBe(201);
    expect(res.body.data.setType).toBe('WORKING');
  });

  it('rejects an invalid setType', async () => {
    const res = await request(app)
      .post(`/api/workouts/${sessionId}/sets`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ exerciseId, setNumber: 4, weightKg: 80, reps: 8, setType: 'GIANT' });
    expect(res.status).toBe(400);
  });

  it('PATCH updates setType and keeps isWarmup in sync', async () => {
    const set = await prisma.workoutSet.findFirst({ where: { sessionId, setNumber: 1 } });
    const res = await request(app)
      .patch(`/api/workouts/sets/${set!.id}`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ setType: 'DROP' });
    expect(res.status).toBe(200);
    expect(res.body.data.setType).toBe('DROP');
    expect(res.body.data.isWarmup).toBe(false);
  });

  it('PATCH without type fields leaves setType untouched', async () => {
    const set = await prisma.workoutSet.findFirst({ where: { sessionId, setNumber: 1 } });
    const res = await request(app)
      .patch(`/api/workouts/sets/${set!.id}`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ weightKg: 105 });
    expect(res.status).toBe(200);
    expect(res.body.data.setType).toBe('DROP');
    expect(res.body.data.weightKg).toBe(105);
  });

  it('POST with conflicting setType and isWarmup: setType wins, isWarmup is derived', async () => {
    const res = await request(app)
      .post(`/api/workouts/${sessionId}/sets`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ exerciseId, setNumber: 5, weightKg: 90, reps: 6, setType: 'DROP', isWarmup: true });
    expect(res.status).toBe(201);
    expect(res.body.data.setType).toBe('DROP');
    expect(res.body.data.isWarmup).toBe(false);

    const stored = await prisma.workoutSet.findUnique({
      where: { sessionId_exerciseId_setNumber: { sessionId, exerciseId, setNumber: 5 } }
    });
    expect(stored?.setType).toBe('DROP');
    expect(stored?.isWarmup).toBe(false);
  });

  it('PATCH with conflicting setType and isWarmup: setType wins, isWarmup is derived', async () => {
    const set = await prisma.workoutSet.findFirst({ where: { sessionId, setNumber: 3 } });
    const res = await request(app)
      .patch(`/api/workouts/sets/${set!.id}`)
      .set('Cookie', [`auth_token=${authToken}`])
      .send({ setType: 'TOP', isWarmup: true });
    expect(res.status).toBe(200);
    expect(res.body.data.setType).toBe('TOP');
    expect(res.body.data.isWarmup).toBe(false);

    const stored = await prisma.workoutSet.findUnique({ where: { id: set!.id } });
    expect(stored?.setType).toBe('TOP');
    expect(stored?.isWarmup).toBe(false);
  });
});
