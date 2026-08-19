/**
 * Shared helpers for parsing and validating OpenFoodFacts macro data.
 * Used by both the runtime OFF client (src/lib/nutrition/openfoodfacts.ts)
 * and the offline CSV import script (scripts/import-off-foods.ts).
 */

export function num(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export const MAX_KCAL = 900;
export const MAX_MACRO = 100;

export function hasSaneMacros(kcal: number, protein: number, carbs: number, fat: number): boolean {
  return (
    kcal > 0 &&
    kcal <= MAX_KCAL &&
    protein >= 0 &&
    protein <= MAX_MACRO &&
    carbs >= 0 &&
    carbs <= MAX_MACRO &&
    fat >= 0 &&
    fat <= MAX_MACRO
  );
}
