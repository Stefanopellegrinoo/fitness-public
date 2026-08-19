import { MacroSet, RecipeNutrition } from '../types/api.types';

/**
 * Preview mirror of the backend's computeRecipeMacros.
 *
 * It exists for one reason: the recipe editor has to show live totals while the
 * draft is still being typed and has never been sent anywhere. Every PERSISTED
 * number still comes from the server, which stays the single source of truth —
 * this only ever renders a preview.
 *
 * Kept deliberately in lockstep with backend/app/src/lib/nutrition/recipeMacros.ts,
 * including the defensive branches: the editor sits in the empty-draft state on
 * every new recipe, so the division by zero is the normal case here, not an edge.
 */

/** Accepts the catalog's optional macros as well as the API's nullable ones. */
export interface RecipeIngredientLike {
  grams: number;
  foodItem: {
    caloriesPer100g?: number | null;
    proteinPer100g?: number | null;
    carbsPer100g?: number | null;
    fatPer100g?: number | null;
  };
}

const ZERO: MacroSet = { calories: 0, protein: 0, carbs: 0, fat: 0 };

function scale(set: MacroSet, factor: number): MacroSet {
  return {
    calories: set.calories * factor,
    protein: set.protein * factor,
    carbs: set.carbs * factor,
    fat: set.fat * factor,
  };
}

export function computeRecipeMacros(
  ingredients: RecipeIngredientLike[],
  servings: number
): RecipeNutrition {
  const safeServings = Number.isFinite(servings) && servings >= 1 ? servings : 1;

  let totalGrams = 0;
  const total: MacroSet = { ...ZERO };
  let hasIncompleteMacros = false;

  for (const { grams, foodItem } of ingredients) {
    const g = Number.isFinite(grams) && grams > 0 ? grams : 0;
    totalGrams += g;

    const values = [
      foodItem.caloriesPer100g,
      foodItem.proteinPer100g,
      foodItem.carbsPer100g,
      foodItem.fatPer100g,
    ];
    if (values.some((v) => v === null || v === undefined)) {
      hasIncompleteMacros = true;
    }

    const factor = g / 100;
    total.calories += (foodItem.caloriesPer100g ?? 0) * factor;
    total.protein += (foodItem.proteinPer100g ?? 0) * factor;
    total.carbs += (foodItem.carbsPer100g ?? 0) * factor;
    total.fat += (foodItem.fatPer100g ?? 0) * factor;
  }

  return {
    totalGrams,
    gramsPerServing: totalGrams / safeServings,
    total,
    per100g: totalGrams > 0 ? scale(total, 100 / totalGrams) : null,
    perServing: scale(total, 1 / safeServings),
    hasIncompleteMacros,
  };
}
