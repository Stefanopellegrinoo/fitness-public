import { NutritionEntry } from '../types/api.types';

/**
 * The unit a diary entry's amount is expressed in.
 *
 * An entry with no `foodItem` is a recipe or a custom food that was never saved
 * to the catalog, and the diary stores GRAMS for both. Reading the amount as
 * units whenever `foodItem` was missing is what displayed 400 g of milanesa as
 * "400 ud" — on six of the eight rows actually stored.
 *
 * Shared rather than duplicated on purpose: the diary row and the edit sheet
 * both label the same number, and two copies of this rule could drift into
 * disagreeing about the same entry.
 *
 * Known residual gap: a custom food entered per-unit and NOT saved to the
 * catalog stores its unit count in `grams` with nothing recording that it was a
 * count, so it reads as grams. Recovering that needs a column on NutritionEntry.
 */
export function entryUnit(entry: NutritionEntry): 'g' | 'ud' {
  if (!entry.foodItem) return 'g';
  return entry.foodItem.isGramBased ? 'g' : 'ud';
}
