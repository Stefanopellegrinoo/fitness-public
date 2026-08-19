import { describe, it, expect } from 'vitest';
import { mapSummaryToMetrics, buildMacrosData } from './dashboard.mapper';
import type { DashboardSummary, NutritionEntry, NutritionGoal } from '../types/api.types';

const baseSummary: DashboardSummary = {
  todayCalories: 2470,
  weeklyWorkouts: 3,
  activeMinutes: 135,
  currentWeightKg: 82.4,
  nextWorkout: null,
};

describe('mapSummaryToMetrics', () => {
  it('maps backend summary fields to dashboard metrics', () => {
    const metrics = mapSummaryToMetrics(baseSummary);

    expect(metrics).toEqual({
      currentWeight: 82.4,
      totalCalories: 2470,
      workouts: 3,
      minutes: 135,
    });
  });

  it('shows a dash when there is no recorded weight', () => {
    const metrics = mapSummaryToMetrics({ ...baseSummary, currentWeightKg: null });

    expect(metrics.currentWeight).toBe('-');
  });

  it('keeps zero values as zero instead of treating them as missing', () => {
    const metrics = mapSummaryToMetrics({
      ...baseSummary,
      todayCalories: 0,
      weeklyWorkouts: 0,
      activeMinutes: 0,
    });

    expect(metrics.totalCalories).toBe(0);
    expect(metrics.workouts).toBe(0);
    expect(metrics.minutes).toBe(0);
  });
});

describe('buildMacrosData', () => {
  /**
   * Both sides of the comparison are built from LOCAL calendar fields.
   *
   * `buildMacrosData` keeps the entries falling on the caller's local day,
   * which is the day the user is looking at. Writing the anchor as local
   * (`'...T15:00:00'`, no `Z`) while writing the entries as fixed UTC instants
   * (`'...T12:00:00.000Z'`) made the two agree only in zones near UTC: at
   * UTC+12:45 that instant is already the NEXT local day, so the filter dropped
   * it and the suite failed in Pacific/Chatham for a mapper that was behaving
   * exactly as specified.
   *
   * `toISOString()` keeps the wire shape the API really sends while pinning the
   * instant to local noon, so the fixture means "an entry from this local day"
   * in every zone.
   */
  const localIso = (year: number, month: number, day: number, hour: number) =>
    new Date(year, month, day, hour).toISOString();

  const today = new Date(2026, 6, 22, 15);

  const entry = (overrides: Partial<NutritionEntry>): NutritionEntry =>
    ({
      id: 'e1',
      userId: 'u1',
      foodName: 'Comida',
      grams: 100,
      mealCategory: 'Almuerzo',
      date: localIso(2026, 6, 22, 12),
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      ...overrides,
    }) as NutritionEntry;

  const goal = {
    kcal: 2600,
    proteinG: 180,
    carbsG: 300,
    fatG: 80,
  } as NutritionGoal;

  it('aggregates only entries from the given day against the goal targets', () => {
    const entries = [
      entry({ id: 'e1', calories: 640, protein: 31, carbs: 80, fat: 24 }),
      entry({ id: 'e2', calories: 650, protein: 55, carbs: 70, fat: 12 }),
      entry({ id: 'e3', date: localIso(2026, 6, 21, 12), calories: 999, protein: 99, carbs: 99, fat: 99 }),
    ];

    const macros = buildMacrosData(entries, goal, today);

    expect(macros).toEqual({
      calories: { current: 1290, target: 2600 },
      protein: { current: 86, target: 180 },
      carbs: { current: 150, target: 300 },
      fat: { current: 36, target: 80 },
    });
  });

  it('falls back to default targets when there is no goal', () => {
    const macros = buildMacrosData([entry({ calories: 500 })], null, today);

    expect(macros.calories).toEqual({ current: 500, target: 2000 });
    expect(macros.protein.target).toBe(150);
    expect(macros.carbs.target).toBe(200);
    expect(macros.fat.target).toBe(65);
  });
});
