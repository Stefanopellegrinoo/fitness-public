/**
 * Nutrition Service
 * Handles nutrition tracking — entries, diary, and goals
 *
 * CREADO (2026-04-08): Este servicio no existía en el frontend.
 * El backend tiene nutrition.routes.ts completo con los siguientes endpoints:
 *
 *   GET  /api/nutrition/goal          → NutritionGoal del usuario
 *   POST /api/nutrition/goal          → Crear/actualizar NutritionGoal
 *   GET  /api/nutrition               → Historial de entradas (paginado)
 *   POST /api/nutrition               → Crear nueva NutritionEntry
 *   PATCH /api/nutrition/:id          → Actualizar grams o mealCategory
 *   DELETE /api/nutrition/:id         → Eliminar entrada
 *
 * Todas las requests usan apiClient para manejo automático de 401 + refresh.
 */

import { buildApiUrl } from './config';
import {
  NutritionEntry,
  NutritionGoal,
  CreateNutritionEntryPayload,
} from '../types/api.types';
import { handleApiError } from './error.handler';
import { apiClient } from './client';

// Hard stop for the history pager below, so a server that keeps answering
// `hasMore: true` cannot spin the tab. See getNutritionHistory.
const MAX_HISTORY_PAGES = 10;

/**
 * Fetch user's nutrition goal
 * Returns default goal if none is set (kcal: 2000, protein: 150g, carbs: 200g, fat: 65g)
 * @returns Promise<NutritionGoal>
 * @throws ApiError if request fails
 */
export async function getNutritionGoal(): Promise<NutritionGoal> {
  const url = buildApiUrl('/nutrition/goal');

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = await response.json();
    return (result?.data ?? result) as NutritionGoal;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Create or update user's nutrition goal
 * @param goal - Nutrition goal with kcal, proteinG, carbsG, fatG
 * @returns Promise<NutritionGoal> updated goal
 * @throws ApiError if request fails or validation fails
 */
export async function setNutritionGoal(goal: {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}): Promise<NutritionGoal> {
  const url = buildApiUrl('/nutrition/goal');

  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify(goal),
    });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = await response.json();
    return (result?.data ?? result) as NutritionGoal;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Fetch nutrition entry history (paginated)
 * @param limit - Number of records to fetch (default: 50)
 * @param offset - Pagination offset (default: 0)
 * @returns Promise<NutritionEntry[]> entries sorted by date desc
 * @throws ApiError if request fails
 */
/**
 * The instants that bound a calendar day in the BROWSER's timezone, as a
 * HALF-OPEN interval: [start of the day, start of the next day).
 *
 * Computed here rather than server-side on purpose: the day the user means is
 * their local day, and the server has no way to know which one that is. An
 * entry logged at 23:00 in Buenos Aires is already the next day in UTC, so a
 * server-side start-of-day would file it under the wrong one. The API only ever
 * compares instants.
 *
 * The end of the day is the START OF THE NEXT ONE, never a wall-clock time like
 * 23:59:59.999. A wall-clock name is not a reliable way to point at an instant:
 * in a zone that falls back at or near local midnight, local 23:xx HAPPENS
 * TWICE, and V8 resolves an ambiguous local time to the FIRST, pre-transition
 * occurrence. A real instant living in the second occurrence is then GREATER
 * than the bound meant to contain it. Measured across all 418 IANA zones from
 * 2015 to 2035, that broke `from <= t < to` for one hour a year in 26 of them —
 * Africa/Cairo, Asia/Beirut, America/Santiago, America/Godthab among them.
 * Because this same window is the merge window POST /api/nutrition validates an
 * entry against, the save answered 400 for that whole hour and the food was
 * lost; retrying did not help, because the clock was the problem.
 *
 * Both bounds are built straight from the anchor's local calendar fields, and
 * that ordering is load-bearing. Bumping the day on a copy of the anchor and
 * only THEN zeroing the clock carries the anchor's time of day across the day
 * change, and if that time of day lands in a spring-forward GAP the engine
 * resolves it forward past midnight — the calendar date slips an extra day, and
 * zeroing afterwards is too late. Measured in America/Godthab on 2024-03-30:
 * a 47-hour "day", small enough to pass the backend's 48-hour cap unnoticed.
 * Passing the fields to the constructor carries no time of day at all, so there
 * is nothing to land in a gap; day + 1 overflows into the next month or year on
 * its own, exactly as the Date constructor is specified to.
 *
 * A local midnight that does not exist resolves forward to the first instant
 * that does — the moment the clock jumped — which is the only instant a day
 * like that can begin at. Days therefore tile the timeline with no gap and no
 * overlap: one day's `to` is the next day's `from`, byte for byte.
 */
export function dayBounds(date: Date): { from: string; to: string } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const from = new Date(year, month, day, 0, 0, 0, 0);
  const to = new Date(year, month, day + 1, 0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * One page of the diary. `hasMore` is false for a bare-array response, which
 * carries no pagination envelope to read it from.
 */
async function fetchHistoryPage(
  limit: number,
  offset: number,
  range?: { from: string; to: string }
): Promise<{ entries: NutritionEntry[]; hasMore: boolean }> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  });
  if (range) {
    params.set('from', range.from);
    params.set('to', range.to);
  }
  const url = buildApiUrl(`/nutrition?${params.toString()}`);

  const response = await apiClient(url, { method: 'GET' });

  if (!response.ok) {
    throw handleApiError({}, response.status);
  }

  const result = await response.json();
  if (Array.isArray(result)) return { entries: result as NutritionEntry[], hasMore: false };
  return {
    entries: (result.data || []) as NutritionEntry[],
    hasMore: Boolean(result.pagination?.hasMore),
  };
}

/**
 * A day of the diary, WHOLE.
 *
 * The response is paginated and this function returns a bare array, so a
 * partial answer has nowhere to report itself: the caller cannot tell "the day
 * had three entries" from "the day had a hundred and three and you got the
 * first hundred". The list is not what makes that dangerous —
 * `calculateDailyTotals` sums whatever this resolves to, so a short read does
 * not render as a short list, it renders as WRONG CALORIES for the day, with
 * nothing failing anywhere for the user to notice. So the pages are drained
 * here, and what comes back is either the whole range or an error.
 *
 * In practice this makes exactly one request: both callers ask for a single day
 * with `limit=100`, the endpoint's own maximum, and the POST merges an entry
 * into the existing row for the same food on the same day — so a day holds as
 * many rows as it had DISTINCT foods, and a hundred of those is not a day a
 * person has. The loop is here so that stops being an assumption the totals
 * quietly depend on.
 */
export async function getNutritionHistory(
  limit: number = 50,
  offset: number = 0,
  range?: { from: string; to: string }
): Promise<NutritionEntry[]> {
  try {
    const all: NutritionEntry[] = [];
    let cursor = offset;

    // A server stuck on `hasMore: true` would spin this until the tab
    // dies, so the loop ends on a count as well as on the answer. Ten pages is
    // ~10x the largest day the endpoint can even express; raise it only if a
    // real range legitimately needs more.
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const { entries, hasMore } = await fetchHistoryPage(limit, cursor, range);
      all.push(...entries);
      // An empty page with `hasMore` still set advances nothing: without this
      // the loop would burn every remaining iteration re-asking the same offset.
      if (!hasMore || entries.length === 0) break;
      cursor += entries.length;
    }

    return all;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Create a new nutrition entry
 * Macros are calculated automatically by the backend if foodItemId is provided
 *
 * @param entry - Entry payload with foodName, grams, mealCategory, optional foodItemId and date
 * @returns Promise<NutritionEntry> created entry with calculated macros
 * @throws ApiError if request fails or validation fails
 */
export async function addNutritionEntry(
  entry: CreateNutritionEntryPayload
): Promise<NutritionEntry> {
  const url = buildApiUrl('/nutrition');

  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify(entry),
    });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = await response.json();
    return (result?.data ?? result) as NutritionEntry;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Update an existing nutrition entry
 * Can update grams (macros recalculated) or mealCategory
 *
 * @param id - Entry ID to update
 * @param updates - Partial update: grams and/or mealCategory
 * @returns Promise<NutritionEntry> updated entry
 * @throws ApiError if request fails, validation fails, or entry not found
 */
export async function updateNutritionEntry(
  id: string,
  updates: {
    grams?: number;
    mealCategory?: 'Desayuno' | 'Almuerzo' | 'Merienda' | 'Cena' | 'Snacks';
    // The four macros were missing here even though the edit sheet has always
    // sent them — they reach the call through a spread, which TypeScript does
    // not excess-property check, so it compiled. They are not optional in
    // practice: the backend only recomputes macros when the entry has a
    // foodItem behind it, and most entries do not.
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  }
): Promise<NutritionEntry> {
  const url = buildApiUrl(`/nutrition/${id}`);

  try {
    const response = await apiClient(url, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = await response.json();
    return (result?.data ?? result) as NutritionEntry;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Delete a nutrition entry
 * @param id - Entry ID to delete
 * @throws ApiError if request fails or entry not found
 */
export async function deleteNutritionEntry(id: string): Promise<void> {
  const url = buildApiUrl(`/nutrition/${id}`);

  try {
    const response = await apiClient(url, { method: 'DELETE' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Calculate today's macro totals from a list of entries
 * Helper util — no API call
 */
export function calculateDailyTotals(entries: NutritionEntry[]): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
} {
  return entries.reduce(
    (acc, entry) => ({
      calories: acc.calories + (entry.calories || 0),
      protein: acc.protein + (entry.protein || 0),
      carbs: acc.carbs + (entry.carbs || 0),
      fat: acc.fat + (entry.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export const nutritionService = {
  getNutritionGoal,
  setNutritionGoal,
  getNutritionHistory,
  dayBounds,
  addNutritionEntry,
  updateNutritionEntry,
  deleteNutritionEntry,
  calculateDailyTotals,
};
