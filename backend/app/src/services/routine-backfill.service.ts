import { PrismaClient, DayOfWeek, SetType } from '@prisma/client';

const WEEKDAY_ORDER: DayOfWeek[] = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];
const WEEKDAY_NAMES: Record<DayOfWeek, string> = {
  LUNES: 'Lunes', MARTES: 'Martes', MIERCOLES: 'Miércoles', JUEVES: 'Jueves',
  VIERNES: 'Viernes', SABADO: 'Sábado', DOMINGO: 'Domingo',
};

export function parseTargetReps(targetReps: string): { repsMin: number | null; repsMax: number | null } {
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(targetReps.trim());
  if (range) return { repsMin: parseInt(range[1], 10), repsMax: parseInt(range[2], 10) };
  const single = /^(\d+)$/.exec(targetReps.trim());
  if (single) {
    const n = parseInt(single[1], 10);
    return { repsMin: n, repsMax: n };
  }
  return { repsMin: null, repsMax: null };
}

export interface RoutineBackfillScope {
  routineIds?: string[];
}

export async function backfillRoutineDays(prisma: PrismaClient, opts?: RoutineBackfillScope) {
  const routines = await prisma.routine.findMany({
    where: opts?.routineIds ? { id: { in: opts.routineIds } } : undefined,
    include: {
      days: { select: { id: true } },
      exercises: { orderBy: { order: 'asc' } },
    },
  });

  let daysCreated = 0;
  let exercisesLinked = 0;
  let plansCreated = 0;
  let routinesSkipped = 0;

  for (const routine of routines) {
    // Idempotency: a routine that already has days was backfilled (or created nested)
    if (routine.days.length > 0) {
      routinesSkipped++;
      continue;
    }

    type Ex = (typeof routine.exercises)[number];
    const groups = new Map<DayOfWeek | 'NONE', Ex[]>();
    for (const ex of routine.exercises) {
      const key = ex.dayOfWeek ?? 'NONE';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(ex);
    }

    const entries: Array<{ name: string; weekday: DayOfWeek | null; exercises: Ex[] }> = [];
    const noneGroup = groups.get('NONE');
    if (noneGroup) entries.push({ name: 'Día 1', weekday: null, exercises: noneGroup });
    for (const weekday of WEEKDAY_ORDER) {
      const group = groups.get(weekday);
      if (group) entries.push({ name: WEEKDAY_NAMES[weekday], weekday, exercises: group });
    }

    await prisma.$transaction(async (tx) => {
      let order = 1;
      for (const entry of entries) {
        const day = await tx.routineDay.create({
          data: { routineId: routine.id, name: entry.name, order, weekday: entry.weekday },
        });
        daysCreated++;
        order++;
        for (const ex of entry.exercises) {
          await tx.routineExercise.update({ where: { id: ex.id }, data: { dayId: day.id } });
          exercisesLinked++;
          const { repsMin, repsMax } = parseTargetReps(ex.targetReps);
          // Guard against bad rows with a non-positive targetSets: clamp to 0 plans
          // instead of letting a negative value corrupt the plansCreated counter.
          const setsToCreate = Math.max(0, ex.targetSets);
          await tx.routineSetPlan.createMany({
            data: Array.from({ length: setsToCreate }, (_, i) => ({
              routineExerciseId: ex.id,
              order: i + 1,
              setType: SetType.WORKING,
              repsMin,
              repsMax,
              targetRpe: ex.targetRpe,
            })),
          });
          plansCreated += setsToCreate;
        }
      }
    });
  }

  // Scoped runs restrict the warmup pass to sets whose session belongs to one
  // of the scoped routines, so a scoped run never touches sets from other routines.
  const { count: warmupSetsUpdated } = await prisma.workoutSet.updateMany({
    where: {
      isWarmup: true,
      setType: { not: SetType.WARMUP },
      ...(opts?.routineIds ? { session: { routineId: { in: opts.routineIds } } } : {}),
    },
    data: { setType: SetType.WARMUP },
  });

  return { routines: routines.length, routinesSkipped, daysCreated, exercisesLinked, plansCreated, warmupSetsUpdated };
}

export async function verifyRoutineBackfill(prisma: PrismaClient, opts?: RoutineBackfillScope) {
  const issues: string[] = [];
  const routineFilter = opts?.routineIds ? { routineId: { in: opts.routineIds } } : {};

  const orphanExercises = await prisma.routineExercise.count({ where: { dayId: null, ...routineFilter } });
  if (orphanExercises > 0) issues.push(`${orphanExercises} RoutineExercise rows have no dayId`);

  const exercises = await prisma.routineExercise.findMany({
    where: routineFilter,
    select: { id: true, targetSets: true, _count: { select: { setPlans: true } } },
  });
  for (const ex of exercises) {
    if (ex._count.setPlans !== ex.targetSets) {
      issues.push(`RoutineExercise ${ex.id}: ${ex._count.setPlans} set plans != targetSets ${ex.targetSets}`);
    }
  }

  const warmupMismatch = await prisma.workoutSet.count({
    where: {
      isWarmup: true,
      setType: { not: 'WARMUP' },
      ...(opts?.routineIds ? { session: { routineId: { in: opts.routineIds } } } : {}),
    },
  });
  if (warmupMismatch > 0) issues.push(`${warmupMismatch} sets have isWarmup=true but setType != WARMUP`);

  return { ok: issues.length === 0, issues };
}
