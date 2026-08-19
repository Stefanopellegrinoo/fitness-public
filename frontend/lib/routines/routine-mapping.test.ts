import { describe, it, expect } from 'vitest';
import { toPayload, fromRoutine, hasAdvancedSetPlans, isExerciseAdvanced, RoutineDraft } from './routine-mapping';
import type { Routine } from '../types/api.types';

const simpleDraft: RoutineDraft = {
  name: 'PPL',
  days: [{
    name: 'Push A', weekday: 'LUNES', order: 1,
    exercises: [{ exerciseId: 'ex1', name: 'Press', order: 0, sets: { workingSets: 3, repsMin: 8, repsMax: 12, rpe: 8 } }],
  }],
};

describe('toPayload', () => {
  it('expands workingSets into WORKING set plans and assigns orders', () => {
    const p = toPayload(simpleDraft);
    expect(p.name).toBe('PPL');
    expect(p.days[0].order).toBe(1);
    expect(p.days[0].weekday).toBe('LUNES');
    expect(p.days[0].exercises[0].order).toBe(0);
    expect(p.days[0].exercises[0].setPlans).toHaveLength(3);
    expect(p.days[0].exercises[0].setPlans[0]).toMatchObject({ order: 1, setType: 'WORKING', repsMin: 8, repsMax: 12, targetRpe: 8 });
    expect(p.days[0].exercises[0].setPlans[2].order).toBe(3);
  });

  it('omits weekday when the day has none', () => {
    const p = toPayload({ ...simpleDraft, days: [{ ...simpleDraft.days[0], weekday: null }] });
    expect(p.days[0].weekday).toBeUndefined();
  });

  it('clamps workingSets to at least 1', () => {
    const p = toPayload({ ...simpleDraft, days: [{ ...simpleDraft.days[0], exercises: [{ ...simpleDraft.days[0].exercises[0], sets: { workingSets: 0 } }] }] });
    expect(p.days[0].exercises[0].setPlans).toHaveLength(1);
  });
});

const routine = (days: any[]): Routine => ({ id: 'r1', name: 'R', days, exercises: [], createdAt: '', updatedAt: '' });

describe('fromRoutine', () => {
  it('derives workingSets and reps from non-WARMUP plans', () => {
    const d = fromRoutine(routine([{
      id: 'd1', name: 'Push', order: 1, weekday: 'LUNES',
      exercises: [{ id: 'e1', exerciseId: 'ex1', order: 0, exercise: { id: 'ex1', name: 'Press' }, setPlans: [
        { order: 1, setType: 'WARMUP', repsMin: 10, repsMax: 10 },
        { order: 2, setType: 'WORKING', repsMin: 6, repsMax: 6, targetRpe: 8 },
        { order: 3, setType: 'WORKING', repsMin: 6, repsMax: 6, targetRpe: 8 },
      ] }],
    }]));
    expect(d.days[0].exercises[0].sets).toMatchObject({ workingSets: 2, repsMin: 6, repsMax: 6, rpe: 8 });
    expect(d.days[0].exercises[0].name).toBe('Press');
  });

  it('falls back to workingSets 1 when an exercise has no plans', () => {
    const d = fromRoutine(routine([{ id: 'd1', name: 'X', order: 1, exercises: [{ id: 'e1', exerciseId: 'ex1', order: 0, setPlans: [] }] }]));
    expect(d.days[0].exercises[0].sets.workingSets).toBe(1);
  });

  it('falls back to workingSets 1 with undefined reps/rpe when all plans are WARMUP', () => {
    const d = fromRoutine(routine([{
      id: 'd1', name: 'Push', order: 1, weekday: 'LUNES',
      exercises: [{ id: 'e1', exerciseId: 'ex1', order: 0, exercise: { id: 'ex1', name: 'Press' }, setPlans: [
        { order: 1, setType: 'WARMUP', repsMin: 10, repsMax: 12 },
        { order: 2, setType: 'WARMUP', repsMin: 8, repsMax: 10 },
      ] }],
    }]));
    const ex = d.days[0].exercises[0];
    expect(ex.advanced).toBe(true);
    expect(ex.setPlans).toEqual([
      { setType: 'WARMUP', repsMin: 10, repsMax: 12 },
      { setType: 'WARMUP', repsMin: 8, repsMax: 10 },
    ]);
    expect(ex.sets).toMatchObject({ workingSets: 1, repsMin: undefined, repsMax: undefined, rpe: undefined });
  });
});

describe('hasAdvancedSetPlans', () => {
  it('is true when any non-WORKING plan exists', () => {
    expect(hasAdvancedSetPlans(routine([{ id: 'd1', name: 'X', order: 1, exercises: [{ id: 'e1', exerciseId: 'ex1', order: 0, setPlans: [{ order: 1, setType: 'TOP', repsMin: 4, repsMax: 6 }] }] }]))).toBe(true);
  });
  it('is false for uniform WORKING plans', () => {
    expect(hasAdvancedSetPlans(routine([{ id: 'd1', name: 'X', order: 1, exercises: [{ id: 'e1', exerciseId: 'ex1', order: 0, setPlans: [{ order: 1, setType: 'WORKING', repsMin: 8, repsMax: 8 }, { order: 2, setType: 'WORKING', repsMin: 8, repsMax: 8 }] }] }]))).toBe(false);
  });
  it('is false for plain uniform WORKING plans with only repsMin/repsMax', () => {
    expect(hasAdvancedSetPlans(routine([{ id: 'd1', name: 'X', order: 1, exercises: [{ id: 'e1', exerciseId: 'ex1', order: 0, setPlans: [{ order: 1, setType: 'WORKING', repsMin: 8, repsMax: 12 }, { order: 2, setType: 'WORKING', repsMin: 8, repsMax: 12 }] }] }]))).toBe(false);
  });
  it('is true when a uniform WORKING plan carries targetWeightKg', () => {
    expect(hasAdvancedSetPlans(routine([{ id: 'd1', name: 'X', order: 1, exercises: [{ id: 'e1', exerciseId: 'ex1', order: 0, setPlans: [{ order: 1, setType: 'WORKING', repsMin: 8, repsMax: 8, targetWeightKg: 80 }, { order: 2, setType: 'WORKING', repsMin: 8, repsMax: 8, targetWeightKg: 80 }] }] }]))).toBe(true);
  });
  it('is true when a uniform WORKING plan carries percentOfTopSet', () => {
    expect(hasAdvancedSetPlans(routine([{ id: 'd1', name: 'X', order: 1, exercises: [{ id: 'e1', exerciseId: 'ex1', order: 0, setPlans: [{ order: 1, setType: 'WORKING', repsMin: 8, repsMax: 8, percentOfTopSet: 90 }, { order: 2, setType: 'WORKING', repsMin: 8, repsMax: 8, percentOfTopSet: 90 }] }] }]))).toBe(true);
  });
  it('is true when a uniform WORKING plan carries targetRir', () => {
    expect(hasAdvancedSetPlans(routine([{ id: 'd1', name: 'X', order: 1, exercises: [{ id: 'e1', exerciseId: 'ex1', order: 0, setPlans: [{ order: 1, setType: 'WORKING', repsMin: 8, repsMax: 8, targetRir: 2 }, { order: 2, setType: 'WORKING', repsMin: 8, repsMax: 8, targetRir: 2 }] }] }]))).toBe(true);
  });
  it('is true when a uniform WORKING plan carries set-level restSeconds', () => {
    expect(hasAdvancedSetPlans(routine([{ id: 'd1', name: 'X', order: 1, exercises: [{ id: 'e1', exerciseId: 'ex1', order: 0, setPlans: [{ order: 1, setType: 'WORKING', repsMin: 8, repsMax: 8, restSeconds: 90 }, { order: 2, setType: 'WORKING', repsMin: 8, repsMax: 8, restSeconds: 90 }] }] }]))).toBe(true);
  });
});

describe('fromRoutine lossless', () => {
  const routine = (days: any[]): any => ({ id: 'r', name: 'R', days, exercises: [], createdAt: '', updatedAt: '' });

  it('preserves setType and rich fields into setPlans and flags advanced', () => {
    const d = fromRoutine(routine([{
      id: 'd', name: 'Push', order: 1, weekday: 'LUNES',
      exercises: [{ id: 'e', exerciseId: 'ex1', order: 0, exercise: { id: 'ex1', name: 'Press' }, setPlans: [
        { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5, targetRpe: 9 },
        { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 },
      ] }],
    }]));
    const ex = d.days[0].exercises[0];
    expect(ex.advanced).toBe(true);
    expect(ex.setPlans).toEqual([
      { setType: 'TOP', repsMin: 3, repsMax: 5, targetRpe: 9 },
      { setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 },
    ]);
  });

  it('flags simple homogeneous WORKING as not advanced and keeps the summary', () => {
    const d = fromRoutine(routine([{
      id: 'd', name: 'Push', order: 1, weekday: 'LUNES',
      exercises: [{ id: 'e', exerciseId: 'ex1', order: 0, exercise: { id: 'ex1', name: 'Press' }, setPlans: [
        { order: 1, setType: 'WORKING', repsMin: 8, repsMax: 12, targetRpe: 8 },
        { order: 2, setType: 'WORKING', repsMin: 8, repsMax: 12, targetRpe: 8 },
      ] }],
    }]));
    const ex = d.days[0].exercises[0];
    expect(ex.advanced).toBe(false);
    expect(ex.sets).toMatchObject({ workingSets: 2, repsMin: 8, repsMax: 12, rpe: 8 });
  });

  it('preserves WARMUP sets in setPlans', () => {
    const d = fromRoutine(routine([{
      id: 'd', name: 'Push', order: 1, weekday: 'LUNES',
      exercises: [{ id: 'e', exerciseId: 'ex1', order: 0, exercise: { id: 'ex1', name: 'Press' }, setPlans: [
        { order: 1, setType: 'WARMUP', repsMin: 10, repsMax: 10 },
        { order: 2, setType: 'WORKING', repsMin: 6, repsMax: 6 },
      ] }],
    }]));
    expect(d.days[0].exercises[0].setPlans?.[0].setType).toBe('WARMUP');
  });
});

describe('toPayload advanced', () => {
  const advDraft: RoutineDraft = {
    name: 'PPL',
    days: [{ name: 'Push', weekday: 'LUNES', order: 1, exercises: [{
      exerciseId: 'ex1', name: 'Squat', order: 0, advanced: true,
      sets: { workingSets: 1 },
      setPlans: [
        { setType: 'TOP', repsMin: 3, repsMax: 5, targetRpe: 9 },
        { setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 },
      ],
    }] }],
  };

  it('serializes setPlans in order and omits undefined fields', () => {
    const p = toPayload(advDraft);
    const plans = p.days[0].exercises[0].setPlans;
    expect(plans).toEqual([
      { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5, targetRpe: 9 },
      { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 },
    ]);
  });

  it('round-trips a routine losslessly (fromRoutine -> toPayload)', () => {
    const routine: any = { id: 'r', name: 'R', exercises: [], createdAt: '', updatedAt: '', days: [{
      id: 'd', name: 'Push', order: 1, weekday: 'LUNES',
      exercises: [{ id: 'e', exerciseId: 'ex1', order: 0, exercise: { id: 'ex1', name: 'P' }, setPlans: [
        { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5, targetRpe: 9, targetWeightKg: 100 },
        { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80, restSeconds: 120 },
      ] }],
    }] };
    const p = toPayload(fromRoutine(routine));
    expect(p.days[0].exercises[0].setPlans).toEqual([
      { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5, targetRpe: 9, targetWeightKg: 100 },
      { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80, restSeconds: 120 },
    ]);
  });
});

describe('isExerciseAdvanced', () => {
  const ex = (setPlans: any[]) => ({ exerciseId: 'e', order: 0, setPlans });

  it('is false for homogeneous WORKING sets with no rich fields', () => {
    expect(isExerciseAdvanced(ex([
      { order: 1, setType: 'WORKING', repsMin: 8, repsMax: 12, targetRpe: 8 },
      { order: 2, setType: 'WORKING', repsMin: 8, repsMax: 12, targetRpe: 8 },
    ]))).toBe(false);
  });

  it('is true when any set is not WORKING', () => {
    expect(isExerciseAdvanced(ex([
      { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5 },
      { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10 },
    ]))).toBe(true);
  });

  it('is true when a rich field is present', () => {
    expect(isExerciseAdvanced(ex([
      { order: 1, setType: 'WORKING', repsMin: 8, percentOfTopSet: 80 },
    ]))).toBe(true);
  });

  it('is true when working sets differ in reps/rpe', () => {
    expect(isExerciseAdvanced(ex([
      { order: 1, setType: 'WORKING', repsMin: 8, repsMax: 10 },
      { order: 2, setType: 'WORKING', repsMin: 6, repsMax: 8 },
    ]))).toBe(true);
  });
});
