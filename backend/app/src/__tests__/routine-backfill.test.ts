import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../lib/prisma';
import { backfillRoutineDays, verifyRoutineBackfill, parseTargetReps } from '../services/routine-backfill.service';

describe('parseTargetReps', () => {
  it('parses a range', () => {
    expect(parseTargetReps('8-12')).toEqual({ repsMin: 8, repsMax: 12 });
  });
  it('parses a single number as fixed reps', () => {
    expect(parseTargetReps('5')).toEqual({ repsMin: 5, repsMax: 5 });
  });
  it('returns nulls for unparseable text', () => {
    expect(parseTargetReps('al fallo')).toEqual({ repsMin: null, repsMax: null });
  });
});

describe('backfillRoutineDays', () => {
  let userId: string;
  let exerciseId: string;
  let multiDayRoutineId: string;
  let flatRoutineId: string;
  let sessionId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `backfill.${Date.now()}@example.com`, password: 'password123' }
    });
    userId = user.id;
    const exercise = await prisma.exercise.create({
      data: { name: `Backfill Press ${Date.now()}`, category: 'PECHO' }
    });
    exerciseId = exercise.id;

    const multi = await prisma.routine.create({
      data: {
        name: 'Backfill Multi', userId,
        exercises: {
          create: [
            { exerciseId, order: 0, targetSets: 3, targetReps: '8-12', dayOfWeek: 'LUNES' },
            { exerciseId, order: 1, targetSets: 2, targetReps: '5', targetRpe: 8, dayOfWeek: 'JUEVES' },
          ]
        }
      }
    });
    multiDayRoutineId = multi.id;

    const flat = await prisma.routine.create({
      data: {
        name: 'Backfill Flat', userId,
        exercises: { create: [{ exerciseId, order: 0, targetSets: 4, targetReps: 'al fallo', dayOfWeek: null }] }
      }
    });
    flatRoutineId = flat.id;

    const session = await prisma.workoutSession.create({
      data: { userId, routineId: multiDayRoutineId, finishedAt: new Date() }
    });
    sessionId = session.id;
    await prisma.workoutSet.create({
      data: { sessionId, exerciseId, setNumber: 1, weightKg: 40, reps: 10, isWarmup: true }
    });
    await prisma.workoutSet.create({
      data: { sessionId, exerciseId, setNumber: 2, weightKg: 80, reps: 5, isWarmup: false }
    });
  });

  afterAll(async () => {
    await prisma.workoutSet.deleteMany({ where: { session: { userId } } });
    await prisma.workoutSession.deleteMany({ where: { userId } });
    await prisma.routine.deleteMany({ where: { userId } });
    await prisma.exercise.delete({ where: { id: exerciseId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('groups exercises into RoutineDay per used weekday, anchored and ordered', async () => {
    await backfillRoutineDays(prisma, { routineIds: [multiDayRoutineId, flatRoutineId] });
    const days = await prisma.routineDay.findMany({
      where: { routineId: multiDayRoutineId },
      orderBy: { order: 'asc' },
      include: { exercises: { include: { setPlans: { orderBy: { order: 'asc' } } } } }
    });
    expect(days).toHaveLength(2);
    expect(days[0].name).toBe('Lunes');
    expect(days[0].weekday).toBe('LUNES');
    expect(days[1].name).toBe('Jueves');
    expect(days[1].weekday).toBe('JUEVES');
    expect(days[0].exercises[0].setPlans).toHaveLength(3);
    expect(days[0].exercises[0].setPlans[0]).toMatchObject({ setType: 'WORKING', repsMin: 8, repsMax: 12 });
    expect(days[1].exercises[0].setPlans).toHaveLength(2);
    expect(days[1].exercises[0].setPlans[0]).toMatchObject({ repsMin: 5, repsMax: 5, targetRpe: 8 });
  });

  it('puts NULL-dayOfWeek exercises into a single "Día 1" with null rep bounds for unparseable reps', async () => {
    const days = await prisma.routineDay.findMany({
      where: { routineId: flatRoutineId },
      include: { exercises: { include: { setPlans: true } } }
    });
    expect(days).toHaveLength(1);
    expect(days[0].name).toBe('Día 1');
    expect(days[0].weekday).toBeNull();
    expect(days[0].exercises[0].setPlans).toHaveLength(4);
    expect(days[0].exercises[0].setPlans[0]).toMatchObject({ repsMin: null, repsMax: null });
  });

  it('maps isWarmup=true sets to setType WARMUP and leaves the rest WORKING', async () => {
    const warm = await prisma.workoutSet.findFirst({ where: { sessionId, setNumber: 1 } });
    const work = await prisma.workoutSet.findFirst({ where: { sessionId, setNumber: 2 } });
    expect(warm!.setType).toBe('WARMUP');
    expect(work!.setType).toBe('WORKING');
  });

  it('is idempotent: a second run creates nothing new', async () => {
    const second = await backfillRoutineDays(prisma, { routineIds: [multiDayRoutineId, flatRoutineId] });
    expect(second.daysCreated).toBe(0);
    expect(second.plansCreated).toBe(0);
  });

  it('verifyRoutineBackfill reports ok after backfill', async () => {
    const verdict = await verifyRoutineBackfill(prisma, { routineIds: [multiDayRoutineId, flatRoutineId] });
    expect(verdict.ok).toBe(true);
    expect(verdict.issues).toEqual([]);
  });

  it('scopes to given routineIds: backfilling only one routine leaves the other un-backfilled', async () => {
    const scopedA = await prisma.routine.create({
      data: {
        name: 'Backfill Scoped A', userId,
        exercises: { create: [{ exerciseId, order: 0, targetSets: 2, targetReps: '10', dayOfWeek: 'MARTES' }] }
      }
    });
    const scopedB = await prisma.routine.create({
      data: {
        name: 'Backfill Scoped B', userId,
        exercises: { create: [{ exerciseId, order: 0, targetSets: 2, targetReps: '10', dayOfWeek: 'MIERCOLES' }] }
      }
    });

    try {
      await backfillRoutineDays(prisma, { routineIds: [scopedA.id] });

      const daysA = await prisma.routineDay.findMany({ where: { routineId: scopedA.id } });
      const daysB = await prisma.routineDay.findMany({ where: { routineId: scopedB.id } });
      expect(daysA.length).toBeGreaterThan(0);
      expect(daysB).toHaveLength(0);
    } finally {
      await prisma.routine.delete({ where: { id: scopedA.id } });
      await prisma.routine.delete({ where: { id: scopedB.id } });
    }
  });

  it('guards non-positive targetSets: creates day, links exercise, zero set plans, no throw', async () => {
    const zeroRoutine = await prisma.routine.create({
      data: {
        name: 'Backfill Zero Sets', userId,
        exercises: { create: [{ exerciseId, order: 0, targetSets: 0, targetReps: '8-12', dayOfWeek: 'SABADO' }] }
      }
    });

    try {
      await backfillRoutineDays(prisma, { routineIds: [zeroRoutine.id] });

      const days = await prisma.routineDay.findMany({
        where: { routineId: zeroRoutine.id },
        include: { exercises: { include: { setPlans: true } } }
      });
      expect(days).toHaveLength(1);
      expect(days[0].exercises).toHaveLength(1);
      expect(days[0].exercises[0].setPlans).toHaveLength(0);
    } finally {
      await prisma.routine.delete({ where: { id: zeroRoutine.id } });
    }
  });
});
