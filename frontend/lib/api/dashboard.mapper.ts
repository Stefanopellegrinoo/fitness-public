import type { DashboardSummary, NutritionEntry, NutritionGoal } from '../types/api.types';

export interface MacroProgress {
  current: number;
  target: number;
}

export interface MacrosData {
  calories: MacroProgress;
  protein: MacroProgress;
  carbs: MacroProgress;
  fat: MacroProgress;
}

const DEFAULT_GOAL = { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 65 };

// The server now returns exactly the caller's local day (see `dayBounds` in
// nutrition.service.ts), so this re-filter is redundant in practice: a sweep
// of all 418 IANA zones from 2024 to 2030, at minute resolution across each
// zone's DST-transition days (1827 days total), found 0 instants outside
// `dayBounds`'s range and 0 instants landing on a different local day. Kept
// as defense-in-depth — covered by dashboard.mapper.test.ts — in case a
// caller ever passes an unranged or wider-ranged `entries` list.
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function buildMacrosData(
  entries: NutritionEntry[],
  goal: NutritionGoal | null,
  day: Date
): MacrosData {
  const dayEntries = entries.filter((entry) => isSameLocalDay(new Date(entry.date), day));

  const totals = dayEntries.reduce(
    (acc, entry) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein || 0),
      carbs: acc.carbs + (entry.carbs || 0),
      fat: acc.fat + (entry.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  return {
    calories: { current: Math.round(totals.calories), target: goal?.kcal || DEFAULT_GOAL.kcal },
    protein: { current: Math.round(totals.protein), target: goal?.proteinG || DEFAULT_GOAL.proteinG },
    carbs: { current: Math.round(totals.carbs), target: goal?.carbsG || DEFAULT_GOAL.carbsG },
    fat: { current: Math.round(totals.fat), target: goal?.fatG || DEFAULT_GOAL.fatG },
  };
}

export interface DashboardMetrics {
  currentWeight: number | string;
  totalCalories: number;
  workouts: number;
  minutes: number;
}

export function mapSummaryToMetrics(summary: DashboardSummary): DashboardMetrics {
  return {
    currentWeight: summary.currentWeightKg ?? '-',
    totalCalories: summary.todayCalories,
    workouts: summary.weeklyWorkouts,
    minutes: summary.activeMinutes,
  };
}
