import { describe, it, expect } from 'vitest';
import { SET_PRESETS } from './set-presets';

const byId = (id: string) => SET_PRESETS.find((p) => p.id === id)!;

describe('SET_PRESETS', () => {
  it('exposes the full catalog', () => {
    expect(SET_PRESETS.map((p) => p.id)).toEqual([
      'straight', 'top-backoff', 'drop', 'myo', 'rest-pause', 'pyramid', 'amrap', 'empty',
    ]);
  });

  it('top-backoff builds one TOP then backoffs with %top', () => {
    const sets = byId('top-backoff').build();
    expect(sets[0].setType).toBe('TOP');
    expect(sets.slice(1).every((s) => s.setType === 'BACKOFF' && s.percentOfTopSet != null)).toBe(true);
  });

  it('empty builds a single WORKING set', () => {
    expect(byId('empty').build()).toEqual([{ setType: 'WORKING' }]);
  });

  it('amrap ends with an AMRAP set', () => {
    const sets = byId('amrap').build();
    expect(sets[sets.length - 1].setType).toBe('AMRAP');
  });

  it('drop builds one WORKING then two DROP sets with descending %top', () => {
    const sets = byId('drop').build();
    expect(sets).toHaveLength(3);
    expect(sets[0]).toMatchObject({ setType: 'WORKING', repsMin: 8, repsMax: 10 });
    expect(sets[1]).toMatchObject({ setType: 'DROP', percentOfTopSet: 80 });
    expect(sets[2]).toMatchObject({ setType: 'DROP', percentOfTopSet: 60 });
  });

  it('myo builds one WORKING then three MYOREP sets', () => {
    const sets = byId('myo').build();
    expect(sets).toHaveLength(4);
    expect(sets[0]).toMatchObject({ setType: 'WORKING', repsMin: 12, repsMax: 15, targetRpe: 9 });
    const myoreps = sets.slice(1);
    expect(myoreps).toHaveLength(3);
    expect(myoreps.every((s) => s.setType === 'MYOREP' && s.repsMin === 3 && s.repsMax === 5)).toBe(true);
  });

  it('rest-pause builds one WORKING then two RESTPAUSE sets', () => {
    const sets = byId('rest-pause').build();
    expect(sets).toHaveLength(3);
    expect(sets[0]).toMatchObject({ setType: 'WORKING', repsMin: 6, repsMax: 8, targetRpe: 9 });
    const restPauses = sets.slice(1);
    expect(restPauses).toHaveLength(2);
    expect(restPauses.every((s) => s.setType === 'RESTPAUSE' && s.repsMin === 2 && s.repsMax === 4)).toBe(true);
  });

  it('pyramid builds three WORKING sets with descending reps', () => {
    const sets = byId('pyramid').build();
    expect(sets).toHaveLength(3);
    expect(sets.every((s) => s.setType === 'WORKING')).toBe(true);
    expect(sets.map((s) => s.repsMin)).toEqual([12, 10, 8]);
    expect(sets.map((s) => s.repsMax)).toEqual([12, 10, 8]);
  });
});
