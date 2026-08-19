import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';
import { parseProgressionQuery } from '../routes/stats.routes';

describe('Stats routes', () => {
  let userId: string;
  let authToken: string;
  let exerciseId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `statsroute.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    const exercise = await prisma.exercise.create({
      data: { name: `StatsRoute ${Date.now()}`, category: 'PECHO', primaryMuscles: ['pecho'] }
    });
    exerciseId = exercise.id;
    const session = await prisma.workoutSession.create({
      data: { userId, startedAt: new Date('2026-07-06T10:00:00Z'), finishedAt: new Date('2026-07-06T11:00:00Z') }
    });
    await prisma.workoutSet.create({
      data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 100, reps: 5, setType: 'TOP' }
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('GET /api/stats/exercises/:exerciseId/progression returns the series', async () => {
    const res = await request(app)
      .get(`/api/stats/exercises/${exerciseId}/progression`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].topSetWeight).toBe(100);
  });

  it('requires auth', async () => {
    const res = await request(app).get(`/api/stats/exercises/${exerciseId}/progression`);
    expect(res.status).toBe(401);
  });

  it('rejects an invalid `from` date with 400', async () => {
    const res = await request(app)
      .get(`/api/stats/exercises/${exerciseId}/progression?from=not-a-date`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBeDefined();
  });

  it('rejects an invalid `to` date with 400', async () => {
    const res = await request(app)
      .get(`/api/stats/exercises/${exerciseId}/progression?to=garbage`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBeDefined();
  });

  it('falls back to the default limit instead of erroring when limit is not a number', async () => {
    const res = await request(app)
      .get(`/api/stats/exercises/${exerciseId}/progression?limit=abc`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('clamps an out-of-range limit instead of erroring', async () => {
    const res = await request(app)
      .get(`/api/stats/exercises/${exerciseId}/progression?limit=500`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /api/stats/exercises/:exerciseId/prs returns PR lists', async () => {
    const res = await request(app)
      .get(`/api/stats/exercises/${exerciseId}/prs`)
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.data.weightPRs).toHaveLength(1);
    expect(res.body.data.weightPRs[0].weightKg).toBe(100);
  });

  it('GET /api/stats/weekly-volume returns per-muscle weekly aggregates', async () => {
    const res = await request(app)
      .get('/api/stats/weekly-volume?weeks=1')
      .set('Cookie', [`auth_token=${authToken}`]);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('parseProgressionQuery', () => {
  it('parses valid from/to into Date instances', () => {
    const result = parseProgressionQuery({ from: '2026-07-01', to: '2026-07-10' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.from).toBeInstanceOf(Date);
      expect(result.data.to).toBeInstanceOf(Date);
    }
  });

  it('fails when `from` is not a valid date', () => {
    const result = parseProgressionQuery({ from: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('fails when `to` is not a valid date', () => {
    const result = parseProgressionQuery({ to: 'garbage' });
    expect(result.success).toBe(false);
  });

  it('defaults limit to 50 when limit is not a number', () => {
    const result = parseProgressionQuery({ limit: 'abc' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(50);
  });

  it('clamps a limit above 100 down to 100', () => {
    const result = parseProgressionQuery({ limit: '500' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(100);
  });

  it('clamps a limit below 1 up to 1', () => {
    const result = parseProgressionQuery({ limit: '-5' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(1);
  });
});
