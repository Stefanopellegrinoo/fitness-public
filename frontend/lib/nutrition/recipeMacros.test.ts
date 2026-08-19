import { describe, it, expect } from 'vitest';
import { computeRecipeMacros } from './recipeMacros';

/**
 * The preview mirror of the backend helper. It exists so the editor can show
 * live totals while the user is still typing; the persisted value always comes
 * from the server. These cases are the backend's, on purpose: if the two ever
 * disagree, that disagreement is what this file is here to catch.
 */

const lentejas = {
  caloriesPer100g: 116, proteinPer100g: 9, carbsPer100g: 20.1, fatPer100g: 0.4,
};
const arroz = {
  caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28.2, fatPer100g: 0.3,
};

describe('computeRecipeMacros (frontend preview)', () => {
  it('sums the ingredients scaled by their grams', () => {
    const n = computeRecipeMacros(
      [{ grams: 300, foodItem: lentejas }, { grams: 200, foodItem: arroz }],
      1
    );

    expect(n.totalGrams).toBe(500);
    expect(n.total.calories).toBeCloseTo(116 * 3 + 130 * 2, 6);
    expect(n.total.protein).toBeCloseTo(9 * 3 + 2.7 * 2, 6);
    expect(n.total.carbs).toBeCloseTo(20.1 * 3 + 28.2 * 2, 6);
    expect(n.total.fat).toBeCloseTo(0.4 * 3 + 0.3 * 2, 6);
  });

  it('derives per100g from the totals', () => {
    const n = computeRecipeMacros([{ grams: 200, foodItem: lentejas }], 1);

    expect(n.per100g?.calories).toBeCloseTo(116, 6);
    expect(n.per100g?.protein).toBeCloseTo(9, 6);
  });

  it('divides by servings for the per-serving values', () => {
    const n = computeRecipeMacros([{ grams: 400, foodItem: lentejas }], 4);

    expect(n.gramsPerServing).toBeCloseTo(100, 6);
    expect(n.perServing.calories).toBeCloseTo(116, 6);
  });

  // The division by zero the backend defends against: an empty draft is a state
  // the editor is in constantly, on every new recipe before the first ingredient.
  it('returns a null per100g instead of NaN when there is no weight', () => {
    const n = computeRecipeMacros([], 1);

    expect(n.totalGrams).toBe(0);
    expect(n.per100g).toBeNull();
    expect(n.total.calories).toBe(0);
    expect(Number.isNaN(n.perServing.calories)).toBe(false);
  });

  it('never emits Infinity when servings is zero or negative', () => {
    const n = computeRecipeMacros([{ grams: 100, foodItem: lentejas }], 0);

    expect(Number.isFinite(n.gramsPerServing)).toBe(true);
    expect(Number.isFinite(n.perServing.calories)).toBe(true);
  });

  it('counts a missing macro as zero and flags the recipe', () => {
    const n = computeRecipeMacros(
      [{ grams: 100, foodItem: { ...lentejas, fatPer100g: null } }],
      1
    );

    expect(n.hasIncompleteMacros).toBe(true);
    expect(n.total.fat).toBe(0);
    expect(n.total.calories).toBeCloseTo(116, 6);
  });

  it('treats an undefined macro the same as a null one', () => {
    const n = computeRecipeMacros(
      [{ grams: 100, foodItem: { ...lentejas, proteinPer100g: undefined } }],
      1
    );

    expect(n.hasIncompleteMacros).toBe(true);
    expect(n.total.protein).toBe(0);
  });

  it('does not flag a recipe whose ingredients are all complete', () => {
    const n = computeRecipeMacros([{ grams: 100, foodItem: lentejas }], 1);

    expect(n.hasIncompleteMacros).toBe(false);
  });

  it('ignores a non-positive gram amount rather than subtracting weight', () => {
    const n = computeRecipeMacros(
      [{ grams: 100, foodItem: lentejas }, { grams: -50, foodItem: arroz }],
      1
    );

    expect(n.totalGrams).toBe(100);
  });
});
