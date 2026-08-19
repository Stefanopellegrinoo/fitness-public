import type { CreateRoutinePayload, Routine, RoutineSetPlan, SetType, Weekday } from '../types/api.types';

// One set plan without a local id (pure; used by mapping + presets).
export type SetPlanSeed = {
  setType: SetType;
  repsMin?: number;
  repsMax?: number;
  targetRpe?: number;
  targetRir?: number;
  percentOfTopSet?: number;
  targetWeightKg?: number;
  restSeconds?: number;
};
// A set plan with a stable local id (used by the editor UI + React keys).
export type SetPlanEntry = SetPlanSeed & { id: string };

let setIdCounter = 0;
export const newSetId = (): string => `sp_${++setIdCounter}`;

export type SetPlanDraft = { workingSets: number; repsMin?: number; repsMax?: number; rpe?: number };
export type ExerciseDraft = {
  exerciseId: string;
  name: string;
  order: number;
  restSeconds?: number;
  notes?: string;
  advanced?: boolean;        // when true, serialize setPlans instead of expanding sets
  sets: SetPlanDraft;        // simple-mode summary
  setPlans?: SetPlanSeed[];  // full list; populated by fromRoutine and by advanced editing
};
export type DayDraft = { name: string; weekday?: Weekday | null; order: number; exercises: ExerciseDraft[] };
export type RoutineDraft = { name: string; days: DayDraft[] };

// The rich set-plan fields shared by RoutineSetPlan (server) and SetPlanSeed
// (client draft). Canonical list — add a new field here once and every
// spread site (planToSeed, seedToPayload, seedAdvanced) picks it up.
const SEED_FIELDS = [
  'repsMin',
  'repsMax',
  'targetRpe',
  'targetRir',
  'percentOfTopSet',
  'targetWeightKg',
  'restSeconds',
] as const;

// Returns a copy of `source` containing only the `keys` whose value is
// present (!= null) — the shared "spread only defined fields" pattern used
// to build partial payload/seed objects without serializing null/undefined.
export function spreadDefined<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[]
): { [P in K]?: NonNullable<T[P]> } {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value != null) result[key as string] = value;
  }
  return result as { [P in K]?: NonNullable<T[P]> };
}

// Minimal structural shape both RoutineSetPlan (server, nullable fields) and
// SetPlanEntry/SetPlanSeed (client draft, undefined-only fields) satisfy —
// lets one predicate serve both without either side casting to the other.
type SetPlanLike = {
  setType: SetType;
  repsMin?: number | null;
  repsMax?: number | null;
  targetRpe?: number | null;
  targetRir?: number | null;
  percentOfTopSet?: number | null;
  targetWeightKg?: number | null;
  restSeconds?: number | null;
};

// True when a set list holds set plans the simple editor cannot represent
// losslessly: any non-WORKING set, any rich field beyond reps/RPE present, or
// a non-uniform reps/RPE tuple across sets.
export function isSetListAdvanced(plans: SetPlanLike[]): boolean {
  if (plans.some((p) => p.setType !== 'WORKING')) return true;
  if (plans.some((p) => p.targetRir != null || p.percentOfTopSet != null || p.targetWeightKg != null || p.restSeconds != null)) {
    return true;
  }
  const uniq = new Set(plans.map((p) => `${p.repsMin ?? null}|${p.repsMax ?? null}|${p.targetRpe ?? null}`));
  return uniq.size > 1;
}

// True when an exercise holds set plans the simple editor cannot represent losslessly.
export function isExerciseAdvanced(ex: { setPlans?: RoutineSetPlan[] }): boolean {
  return isSetListAdvanced(ex.setPlans ?? []);
}

function seedToPayload(seed: SetPlanSeed, order: number) {
  return {
    order,
    setType: seed.setType,
    ...spreadDefined(seed, SEED_FIELDS),
  };
}

// Draft -> nested payload. Day order is 1-based (backend @@unique([routineId, order]));
// exercise order is 0-based (matches the existing flat contract); set-plan order is 1-based.
// Advanced exercises serialize their setPlans list; simple exercises expand
// workingSets into identical WORKING sets (unchanged).
export function toPayload(draft: RoutineDraft): CreateRoutinePayload {
  return {
    name: draft.name.trim(),
    days: draft.days.map((day, di) => ({
      name: day.name.trim(),
      order: di + 1,
      ...(day.weekday ? { weekday: day.weekday } : {}),
      exercises: day.exercises.map((ex, ei) => ({
        exerciseId: ex.exerciseId,
        order: ei,
        ...(ex.restSeconds != null ? { restSeconds: ex.restSeconds } : {}),
        ...(ex.notes ? { notes: ex.notes } : {}),
        setPlans:
          ex.advanced && ex.setPlans && ex.setPlans.length > 0
            ? ex.setPlans.map((s, si) => seedToPayload(s, si + 1))
            : Array.from({ length: Math.max(1, ex.sets.workingSets) }, (_, si) => ({
                order: si + 1,
                setType: 'WORKING' as const,
                ...(ex.sets.repsMin != null ? { repsMin: ex.sets.repsMin } : {}),
                ...(ex.sets.repsMax != null ? { repsMax: ex.sets.repsMax } : {}),
                ...(ex.sets.rpe != null ? { targetRpe: ex.sets.rpe } : {}),
              })),
      })),
    })),
  };
}

const BY_ORDER = (a: { order: number }, b: { order: number }) => a.order - b.order;

function planToSeed(p: RoutineSetPlan): SetPlanSeed {
  return { setType: p.setType, ...spreadDefined(p, SEED_FIELDS) };
}

// Nested routine -> draft. Lossless: every set plan is preserved into setPlans,
// while sets{} keeps a simple summary for simple-mode editing.
export function fromRoutine(routine: Routine): RoutineDraft {
  return {
    name: routine.name,
    days: [...(routine.days ?? [])].sort(BY_ORDER).map((day) => ({
      name: day.name,
      weekday: day.weekday ?? null,
      order: day.order,
      exercises: [...day.exercises].sort(BY_ORDER).map((ex) => {
        const plans = [...(ex.setPlans ?? [])].sort(BY_ORDER);
        const working = plans.filter((p) => p.setType !== 'WARMUP');
        const first = working[0];
        return {
          exerciseId: ex.exerciseId,
          name: ex.exercise?.name ?? '',
          order: ex.order,
          restSeconds: ex.restSeconds ?? undefined,
          notes: ex.notes ?? undefined,
          advanced: isExerciseAdvanced(ex),
          setPlans: plans.map(planToSeed),
          sets: {
            workingSets: working.length || 1,
            repsMin: first?.repsMin ?? undefined,
            repsMax: first?.repsMax ?? undefined,
            rpe: first?.targetRpe ?? undefined,
          },
        };
      }),
    })),
  };
}

// True when a routine holds set plans the simple editor cannot represent losslessly.
export function hasAdvancedSetPlans(routine: Routine): boolean {
  return (routine.days ?? []).some((day) => day.exercises.some(isExerciseAdvanced));
}
