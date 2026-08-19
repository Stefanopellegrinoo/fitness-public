import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

describe('Routines CRUD (characterization of current behavior)', () => {
  let userId: string;
  let otherUserId: string;
  let authToken: string;
  let exerciseId: string;
  let routineId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `routine.char.${Date.now()}@example.com`, password: 'password123', name: 'Routine Char' }
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;

    const other = await prisma.user.create({
      data: { email: `routine.char.other.${Date.now()}@example.com`, password: 'password123', name: 'Other' }
    });
    otherUserId = other.id;

    const exercise = await prisma.exercise.create({
      data: { name: `Char Press ${Date.now()}`, category: 'PECHO', equipment: 'BARBELL' }
    });
    exerciseId = exercise.id;
  });

  afterAll(async () => {
    await prisma.routine.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  // CUTOVER (Task 8): the flat contract is intentionally gone
  it('POST /api/routines rejects the old flat exercises payload with 400', async () => {
    const res = await request(app)
      .post('/api/routines')
      .set('Cookie', [`auth_token=${authToken}`])
      .send({
        name: 'Char Routine',
        exercises: [{ exerciseId, order: 0, targetSets: 3, targetReps: '8-12', dayOfWeek: 'LUNES' }]
      });
    expect(res.status).toBe(400);
  });

  // STABLE: must pass before and after cutover
  it('GET /api/routines returns only own routines with exercises included', async () => {
    const routine = await prisma.routine.create({
      data: {
        name: 'Char GET', userId,
        exercises: { create: [{ exerciseId, order: 0, targetSets: 3, targetReps: '8-12' }] }
      }
    });
    routineId = routine.id;
    const res = await request(app)
      .get('/api/routines')
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: any) => r.id)).toContain(routineId);
    expect(res.body.data.find((r: any) => r.id === routineId).exercises).toHaveLength(1);
  });

  // STABLE
  it('GET /api/routines/:id returns 404 for a routine owned by another user', async () => {
    const foreign = await prisma.routine.create({ data: { name: 'Foreign', userId: otherUserId } });
    const res = await request(app)
      .get(`/api/routines/${foreign.id}`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(404);
  });

  // STABLE
  it('DELETE /api/routines/:id deletes the routine and cascades exercises', async () => {
    const res = await request(app)
      .delete(`/api/routines/${routineId}`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    const orphans = await prisma.routineExercise.count({ where: { routineId } });
    expect(orphans).toBe(0);
  });
});
