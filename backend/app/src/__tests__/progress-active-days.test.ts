import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Días Activos" must count distinct calendar days with at least one session,
 * NOT the raw session count. Two sessions on the same day is one active day.
 */
describe('Progress workouts activeDays counts distinct calendar days', () => {
  let userId: string;
  let authToken: string;
  let exerciseId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `activedays.${Date.now()}@example.com`, password: 'password123' },
    });
    userId = user.id;
    authToken = authService.generateTokens({ userId: user.id, email: user.email }).accessToken;
    const exercise = await prisma.exercise.create({
      data: { name: `ActiveDays ${Date.now()}`, category: 'PECHO', primaryMuscles: ['pecho'] },
    });
    exerciseId = exercise.id;

    // Anchor to fixed past days at noon/evening so no run-time crosses a midnight boundary.
    const now = new Date();
    const dayANoon = new Date(now.getTime() - 3 * DAY_MS);
    dayANoon.setHours(12, 0, 0, 0);
    const dayAEvening = new Date(now.getTime() - 3 * DAY_MS);
    dayAEvening.setHours(17, 0, 0, 0);
    const dayBNoon = new Date(now.getTime() - 4 * DAY_MS);
    dayBNoon.setHours(12, 0, 0, 0);

    // 3 sessions across 2 distinct calendar days. Each logs a set: a session with
    // zero sets is no longer counted at all, so without one this fixture would
    // report 0 sessions and 0 active days and stop testing the grouping.
    for (const startedAt of [dayANoon, dayAEvening, dayBNoon]) {
      const session = await prisma.workoutSession.create({
        data: { userId, startedAt, finishedAt: startedAt },
      });
      await prisma.workoutSet.create({
        data: { sessionId: session.id, exerciseId, setNumber: 1, weightKg: 50, reps: 10 },
      });
    }
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('returns activeDays as distinct days summed across weeks, not session count', async () => {
    const res = await request(app)
      .get('/api/progress/workouts?weeks=2')
      .set('Cookie', [`auth_token=${authToken}`]);

    expect(res.status).toBe(200);

    const totalSessions = res.body.data.reduce(
      (sum: number, point: { sessions: number }) => sum + point.sessions,
      0
    );
    const totalActiveDays = res.body.data.reduce(
      (sum: number, point: { activeDays: number }) => sum + point.activeDays,
      0
    );

    expect(totalSessions).toBe(3);
    expect(totalActiveDays).toBe(2);
  });
});
