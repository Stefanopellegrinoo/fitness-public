import type { PlannedSet, WorkoutSessionExercise, WorkoutSet } from '@/lib/types/api.types';

export interface SessionSet {
  id: string;
  weight: number;
  reps: number;
  completed: boolean;
  isGhost?: boolean;
  plan?: PlannedSet;
}

export interface SessionExercise {
  id: string;
  name: string;
  muscleGroup: string;
  sets: SessionSet[];
  targetSets?: number;
  targetReps?: string;
  targetRpe?: number;
}

type SessionLike = { exercises?: WorkoutSessionExercise[]; sets?: WorkoutSet[] };

const loggedToSet = (s: WorkoutSet, plan?: PlannedSet): SessionSet => ({
  id: s.id,
  weight: s.weightKg,
  reps: s.reps,
  completed: true,
  ...(plan ? { plan } : {}),
});

/** Build the Exercise[] the active-workout UI consumes, threading planSnapshot into per-set rows. */
export function buildSessionExercises(session: SessionLike): SessionExercise[] {
  const loggedByExercise = new Map<string, WorkoutSet[]>();
  for (const s of session.sets ?? []) {
    const arr = loggedByExercise.get(s.exerciseId) ?? [];
    arr.push(s);
    loggedByExercise.set(s.exerciseId, arr);
  }

  const map = new Map<string, SessionExercise>();

  for (const se of session.exercises ?? []) {
    const logged = [...(loggedByExercise.get(se.exerciseId) ?? [])].sort((a, b) => a.setNumber - b.setNumber);
    const plan = [...(se.planSnapshot ?? [])].sort((a, b) => a.order - b.order);
    const exRow: SessionExercise = {
      id: se.exerciseId,
      name: se.exercise?.name ?? 'Ejercicio',
      muscleGroup: se.exercise?.category ?? 'OTROS',
      targetSets: se.targetSets ?? undefined,
      targetReps: se.targetReps ?? undefined,
      targetRpe: se.targetRpe ?? undefined,
      sets: [],
    };
    if (plan.length > 0) {
      const usedLogIds = new Set<string>();
      plan.forEach((p) => {
        const log = logged.find((l) => l.setNumber === p.order && !usedLogIds.has(l.id));
        if (log) usedLogIds.add(log.id);
        exRow.sets.push(
          log
            ? loggedToSet(log, p)
            : { id: `plan-${se.exerciseId}-${p.order}`, weight: 0, reps: p.repsMin ?? 10, completed: false, plan: p },
        );
      });
      logged.filter((l) => !usedLogIds.has(l.id)).forEach((log) => exRow.sets.push(loggedToSet(log)));
    } else {
      logged.forEach((log) => exRow.sets.push(loggedToSet(log)));
      if (exRow.sets.length === 0) {
        exRow.sets.push({ id: `temp-${se.exerciseId}-1`, weight: 0, reps: 10, completed: false });
      }
    }
    map.set(se.exerciseId, exRow);
  }

  // Safety: exercises present only in logged sets.
  for (const [exerciseId, logged] of loggedByExercise) {
    if (map.has(exerciseId)) continue;
    const sorted = [...logged].sort((a, b) => a.setNumber - b.setNumber);
    const first = sorted[0];
    map.set(exerciseId, {
      id: exerciseId,
      name: first.exercise?.name ?? 'Ejercicio',
      muscleGroup: first.exercise?.category ?? 'OTROS',
      sets: sorted.map((log) => loggedToSet(log)),
    });
  }

  const result = Array.from(map.values());
  for (const exRow of result) {
    if (exRow.sets.length === 0) exRow.sets.push({ id: `temp-${exRow.id}-1`, weight: 0, reps: 10, completed: false });
  }
  return result;
}
