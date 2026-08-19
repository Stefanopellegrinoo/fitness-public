import { describe, it, expect } from 'vitest';
import {
  CreateRoutineSchema,
  RoutineSetPlanSchema,
} from '../validations/routine.validation';

const validExerciseId = '4f9d38f0-93a1-4d6e-9f3a-2b6a1c9d4e5f';

function validPayload() {
  return {
    name: 'PPL',
    days: [
      {
        name: 'Push A',
        order: 1,
        weekday: 'LUNES',
        exercises: [
          {
            exerciseId: validExerciseId,
            order: 0,
            restSeconds: 120,
            setPlans: [
              { order: 1, setType: 'TOP', repsMin: 4, repsMax: 6, targetRpe: 9 },
              { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 90 },
            ],
          },
        ],
      },
    ],
  };
}

describe('CreateRoutineSchema', () => {
  it('accepts a valid nested payload', () => {
    const result = CreateRoutineSchema.safeParse(validPayload());
    expect(result.success).toBe(true);
  });

  it('rejects a routine with zero days', () => {
    const payload = { ...validPayload(), days: [] };
    expect(CreateRoutineSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a day with zero exercises', () => {
    const payload = validPayload();
    payload.days[0].exercises = [];
    expect(CreateRoutineSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects the same exercise twice in one day', () => {
    const payload = validPayload();
    payload.days[0].exercises.push({ ...payload.days[0].exercises[0], order: 1 });
    expect(CreateRoutineSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts an exercise with an empty setPlans list (free-form logging)', () => {
    const payload = validPayload();
    payload.days[0].exercises[0].setPlans = [];
    expect(CreateRoutineSchema.safeParse(payload).success).toBe(true);
  });

  it('rejects the old flat payload shape', () => {
    const flat = {
      name: 'Old',
      exercises: [{ exerciseId: validExerciseId, order: 0, targetSets: 3, targetReps: '8-12' }],
    };
    expect(CreateRoutineSchema.safeParse(flat).success).toBe(false);
  });

  it('rejects a routine name shorter than 3 characters', () => {
    const payload = { ...validPayload(), name: 'PP' };
    expect(CreateRoutineSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a day with an empty name', () => {
    const payload = validPayload();
    payload.days[0].name = '';
    expect(CreateRoutineSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects an invalid weekday value', () => {
    const payload = validPayload();
    payload.days[0].weekday = 'FUNDAY';
    expect(CreateRoutineSchema.safeParse(payload).success).toBe(false);
  });
});

describe('RoutineSetPlanSchema', () => {
  it('defaults setType to WORKING', () => {
    const result = RoutineSetPlanSchema.safeParse({ order: 1 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.setType).toBe('WORKING');
  });

  it('rejects repsMin > repsMax', () => {
    expect(RoutineSetPlanSchema.safeParse({ order: 1, repsMin: 10, repsMax: 5 }).success).toBe(false);
  });

  it('rejects out-of-range targetRpe / targetRir / percentOfTopSet', () => {
    expect(RoutineSetPlanSchema.safeParse({ order: 1, targetRpe: 11 }).success).toBe(false);
    expect(RoutineSetPlanSchema.safeParse({ order: 1, targetRir: 11 }).success).toBe(false);
    expect(RoutineSetPlanSchema.safeParse({ order: 1, percentOfTopSet: 0 }).success).toBe(false);
  });

  it('accepts an in-range targetRir', () => {
    const result = RoutineSetPlanSchema.safeParse({ order: 1, targetRir: 5 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.targetRir).toBe(5);
  });

  it('rejects an invalid setType value', () => {
    expect(RoutineSetPlanSchema.safeParse({ order: 1, setType: 'SUPERSET' }).success).toBe(false);
  });
});
