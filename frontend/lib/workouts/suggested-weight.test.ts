import { describe, it, expect } from 'vitest';
import { computeSuggestedWeight } from './suggested-weight';
import type { PlannedSet } from '@/lib/types/api.types';

const plan = (p: Partial<PlannedSet>): PlannedSet => ({ order: 1, setType: 'WORKING', ...p });

describe('computeSuggestedWeight', () => {
  it('uses explicit targetWeightKg over percentOfTopSet', () => {
    expect(computeSuggestedWeight(plan({ targetWeightKg: 90, percentOfTopSet: 80 }), 100)).toBe(90);
  });

  it('computes percentOfTopSet of the heaviest logged non-warmup weight', () => {
    expect(computeSuggestedWeight(plan({ percentOfTopSet: 80 }), 100)).toBe(80);
  });

  it('rounds to the nearest 0.5 kg', () => {
    expect(computeSuggestedWeight(plan({ percentOfTopSet: 80 }), 101)).toBe(81); // 80.8 -> 81.0
    expect(computeSuggestedWeight(plan({ percentOfTopSet: 82.5 }), 100)).toBe(82.5);
  });

  it('is dynamic: a heavier reference yields a heavier suggestion', () => {
    expect(computeSuggestedWeight(plan({ percentOfTopSet: 80 }), 110)).toBe(88);
  });

  it('returns undefined when there is no reference weight yet', () => {
    expect(computeSuggestedWeight(plan({ percentOfTopSet: 80 }), null)).toBeUndefined();
  });

  it('returns undefined when the set has neither target weight nor %top', () => {
    expect(computeSuggestedWeight(plan({ repsMin: 8 }), 100)).toBeUndefined();
  });
});
