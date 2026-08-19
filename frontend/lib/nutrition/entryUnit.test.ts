import { describe, it, expect } from 'vitest';
import { entryUnit } from './entryUnit';
import { NutritionEntry } from '../types/api.types';

const entry = (over: Partial<NutritionEntry>): NutritionEntry => ({
  id: 'e1', userId: 'u1', foodName: 'Algo', grams: 100,
  mealCategory: 'Desayuno', calories: 100, protein: 5, carbs: 10, fat: 2,
  date: '2026-07-30T00:00:00.000Z', status: 'COMPLETED', ...over,
});

describe('entryUnit', () => {
  it('reads grams for a catalog food weighed in grams', () => {
    expect(entryUnit(entry({
      foodItem: { id: 'f1', name: 'Banana', isGramBased: true },
    }))).toBe('g');
  });

  it('reads units for a catalog food counted in units', () => {
    expect(entryUnit(entry({
      foodItem: { id: 'f2', name: 'Huevo', isGramBased: false },
    }))).toBe('ud');
  });

  // The live defect this function exists to close: a recipe entry has no
  // foodItem by design, and so does a custom food not saved to the catalog.
  it('reads grams when nothing from the catalog backs the entry', () => {
    expect(entryUnit(entry({}))).toBe('g');
  });
});
