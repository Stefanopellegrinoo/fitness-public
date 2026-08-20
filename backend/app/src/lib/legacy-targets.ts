// Legacy dual-write: derives the flat RoutineExercise/WorkoutSessionExercise target columns
// (targetSets/targetReps/targetRpe — slated for removal) from the nested setPlans, so consumers
// still reading legacy fields (e.g. today's frontend, startWorkout's snapshot) stay coherent.
//
// Semantics (pinned by routines-nested.test.ts — do not change without updating those tests):
//   - WARMUP set plans are excluded from targetSets/targetReps/targetRpe derivation.
//   - targetSets = count of non-WARMUP ("working") plans.
//   - targetReps is taken from the first working plan (by `order`): collapsed to a single
//     number when repsMin === repsMax, otherwise "min-max". Omitted if either bound is missing.
//   - targetRpe is the first working plan's targetRpe (or null).

export interface LegacySetPlanInput {
  order: number;
  setType: string;
  repsMin?: number | null;
  repsMax?: number | null;
  targetRpe?: number | null;
}

export interface LegacyExerciseFields {
  targetRpe: number | null;
  targetSets?: number;
  targetReps?: string;
}

export function computeLegacyExerciseFields(setPlans: LegacySetPlanInput[]): LegacyExerciseFields {
  const workingPlans = [...setPlans]
    .sort((a, b) => a.order - b.order)
    .filter((plan) => plan.setType !== 'WARMUP');
  const first = workingPlans[0];

  const fields: LegacyExerciseFields = {
    targetRpe: first?.targetRpe ?? null,
  };
  if (workingPlans.length > 0) {
    fields.targetSets = workingPlans.length;
  }
  if (first?.repsMin != null && first?.repsMax != null) {
    fields.targetReps = first.repsMin === first.repsMax ? `${first.repsMin}` : `${first.repsMin}-${first.repsMax}`;
  }
  return fields;
}
