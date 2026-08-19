import { describe, it, expect } from 'vitest';
import { computeRecipeMacros, type RecipeIngredientLike } from '../lib/nutrition/recipeMacros';

const food = (
  calories: number | null,
  protein: number | null,
  carbs: number | null,
  fat: number | null
) => ({
  caloriesPer100g: calories,
  proteinPer100g: protein,
  carbsPer100g: carbs,
  fatPer100g: fat,
});

// 200g @ 100kcal/100g = 200kcal; 100g @ 50kcal/100g = 50kcal => 250kcal total
const twoIngredients: RecipeIngredientLike[] = [
  { grams: 200, foodItem: food(100, 10, 20, 1) },
  { grams: 100, foodItem: food(50, 4, 6, 2) },
];

describe('computeRecipeMacros', () => {
  it('sums macros scaled by grams and reports total weight', () => {
    const r = computeRecipeMacros(twoIngredients, 1);
    expect(r.totalGrams).toBe(300);
    expect(r.total.calories).toBeCloseTo(250);
    expect(r.total.protein).toBeCloseTo(24);
    expect(r.total.carbs).toBeCloseTo(46);
    expect(r.total.fat).toBeCloseTo(4);
  });

  it('derives per-100g values from the total weight', () => {
    const r = computeRecipeMacros(twoIngredients, 1);
    expect(r.per100g).not.toBeNull();
    expect(r.per100g!.calories).toBeCloseTo((250 / 300) * 100);
    expect(r.per100g!.protein).toBeCloseTo(8);
  });

  it('splits totals and weight across servings', () => {
    const r = computeRecipeMacros(twoIngredients, 4);
    expect(r.perServing.calories).toBeCloseTo(62.5);
    expect(r.gramsPerServing).toBeCloseTo(75);
  });

  it('returns per100g null instead of NaN when there are no ingredients', () => {
    const r = computeRecipeMacros([], 1);
    expect(r.totalGrams).toBe(0);
    expect(r.per100g).toBeNull();
    expect(r.total.calories).toBe(0);
    expect(Number.isNaN(r.perServing.calories)).toBe(false);
  });

  it('returns per100g null when every ingredient weighs zero', () => {
    const r = computeRecipeMacros([{ grams: 0, foodItem: food(100, 10, 20, 1) }], 1);
    expect(r.per100g).toBeNull();
    expect(Number.isFinite(r.total.calories)).toBe(true);
  });

  it('treats null macros as 0 and flags the recipe as incomplete', () => {
    const r = computeRecipeMacros(
      [
        { grams: 100, foodItem: food(100, 10, 20, 1) },
        { grams: 100, foodItem: food(200, null, 30, 5) },
      ],
      1
    );
    expect(r.total.calories).toBeCloseTo(300);
    expect(r.total.protein).toBeCloseTo(10); // el null suma 0
    expect(r.hasIncompleteMacros).toBe(true);
  });

  it('does not flag recipes whose ingredients have all four macros', () => {
    expect(computeRecipeMacros(twoIngredients, 1).hasIncompleteMacros).toBe(false);
  });

  it('never divides by zero when servings is invalid', () => {
    const r = computeRecipeMacros(twoIngredients, 0);
    expect(Number.isFinite(r.perServing.calories)).toBe(true);
    expect(Number.isFinite(r.gramsPerServing)).toBe(true);
  });
});
