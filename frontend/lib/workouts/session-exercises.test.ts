import { describe, it, expect } from 'vitest';
import { buildSessionExercises } from './session-exercises';

const ex = { id: 'ex1', name: 'Squat', category: 'PIERNAS' };

describe('buildSessionExercises', () => {
  it('builds one row per planned set, each carrying its plan, ordered', () => {
    const out = buildSessionExercises({
      exercises: [{ exerciseId: 'ex1', exercise: ex, planSnapshot: [
        { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 },
        { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5 },
      ] }],
      sets: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].sets.map((s) => s.plan?.setType)).toEqual(['TOP', 'BACKOFF']);
    expect(out[0].sets.every((s) => !s.completed)).toBe(true);
  });

  it('merges logged sets onto planned rows by order and marks them completed', () => {
    const out = buildSessionExercises({
      exercises: [{ exerciseId: 'ex1', exercise: ex, planSnapshot: [
        { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5 },
        { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 },
      ] }],
      sets: [{ id: 'log1', exerciseId: 'ex1', setNumber: 1, weightKg: 100, reps: 4, isWarmup: false }],
    });
    expect(out[0].sets[0]).toMatchObject({ id: 'log1', weight: 100, reps: 4, completed: true });
    expect(out[0].sets[0].plan?.setType).toBe('TOP');
    expect(out[0].sets[1].completed).toBe(false);
  });

  it('appends extra logged sets beyond the plan as plain rows (no plan)', () => {
    const out = buildSessionExercises({
      exercises: [{ exerciseId: 'ex1', exercise: ex, planSnapshot: [
        { order: 1, setType: 'WORKING', repsMin: 8, repsMax: 12 },
      ] }],
      sets: [
        { id: 'l1', exerciseId: 'ex1', setNumber: 1, weightKg: 50, reps: 10, isWarmup: false },
        { id: 'l2', exerciseId: 'ex1', setNumber: 2, weightKg: 50, reps: 9, isWarmup: false },
      ],
    });
    expect(out[0].sets).toHaveLength(2);
    expect(out[0].sets[1]).toMatchObject({ id: 'l2', completed: true });
    expect(out[0].sets[1].plan).toBeUndefined();
  });

  it('falls back to count-based rows when an exercise has no planSnapshot', () => {
    const out = buildSessionExercises({
      exercises: [{ exerciseId: 'ex1', exercise: ex, planSnapshot: [], targetSets: 3, targetReps: '8-12' }],
      sets: [],
    });
    expect(out[0].targetReps).toBe('8-12');
    expect(out[0].sets).toHaveLength(1);
    expect(out[0].sets[0].completed).toBe(false);
    expect(out[0].sets[0].plan).toBeUndefined();
  });

  it('recovers an exercise present only in logged sets', () => {
    const out = buildSessionExercises({
      exercises: [],
      sets: [{ id: 'l1', exerciseId: 'exX', exercise: { id: 'exX', name: 'Curl', category: 'BRAZOS' }, setNumber: 1, weightKg: 20, reps: 12, isWarmup: false }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('exX');
    expect(out[0].sets[0]).toMatchObject({ weight: 20, completed: true });
  });

  it('matches logged sets to planned sets by setNumber===order, tolerating gaps', () => {
    const out = buildSessionExercises({
      exercises: [{ exerciseId: 'ex1', exercise: ex, planSnapshot: [
        { order: 1, setType: 'TOP', repsMin: 3, repsMax: 5 },
        { order: 2, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 },
        { order: 3, setType: 'BACKOFF', repsMin: 8, repsMax: 10, percentOfTopSet: 80 },
      ] }],
      sets: [
        { id: 'log1', exerciseId: 'ex1', setNumber: 1, weightKg: 100, reps: 4, isWarmup: false },
        { id: 'log3', exerciseId: 'ex1', setNumber: 3, weightKg: 80, reps: 9, isWarmup: false },
      ],
    });
    expect(out[0].sets).toHaveLength(3);
    expect(out[0].sets[0]).toMatchObject({ id: 'log1', completed: true });
    expect(out[0].sets[0].plan?.setType).toBe('TOP');
    expect(out[0].sets[1].completed).toBe(false);        // order 2, gap → unlogged
    expect(out[0].sets[1].plan?.order).toBe(2);
    expect(out[0].sets[2]).toMatchObject({ id: 'log3', completed: true });
    expect(out[0].sets[2].plan?.order).toBe(3);          // NOT misassigned to order 2
  });
});
