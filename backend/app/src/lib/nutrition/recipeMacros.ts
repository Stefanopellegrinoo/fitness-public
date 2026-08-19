/**
 * Pure macro math for recipes. No Prisma, no I/O — the route layer loads the
 * ingredients and hands them over as plain objects.
 *
 * Recipe macros are NEVER persisted: they are derived from the referenced
 * FoodItems on every read, so the catalog stays the single source of truth.
 */

export interface MacroSet {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** The shape the route layer must provide — a subset of a loaded RecipeIngredient. */
export interface RecipeIngredientLike {
  grams: number;
  foodItem: {
    caloriesPer100g: number | null;
    proteinPer100g: number | null;
    carbsPer100g: number | null;
    fatPer100g: number | null;
  };
}

export interface RecipeNutrition {
  totalGrams: number;
  gramsPerServing: number;
  total: MacroSet;
  /** null when totalGrams is 0 — there is no meaningful "per 100g" of nothing. */
  per100g: MacroSet | null;
  perServing: MacroSet;
  /** true when any ingredient is missing any of the four per-100g values. */
  hasIncompleteMacros: boolean;
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
  // Defensive: the API validates servings >= 1, but the helper is reusable and
  // must never emit Infinity/NaN on its own.
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
