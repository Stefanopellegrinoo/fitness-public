/**
 * Dashboard Service
 * Handles dashboard-related API calls
 *
 * FIX (2026-04-08): Endpoint corregido de '/dashboard/summary' → '/dashboard'
 * El backend monta la ruta summary en GET /api/dashboard (no /api/dashboard/summary)
 *
 * Backend endpoints disponibles (dashboard.routes.ts):
 *   GET /api/dashboard          → summary (todayCalories, weeklyWorkouts, activeMinutes, nextWorkout)
 *   GET /api/dashboard/stats/volume → Volume stats por muscle group (current vs previous week)
 */

import { buildApiUrl } from './config';
import { DashboardSummary } from '../types/api.types';
import { handleApiError } from './error.handler';
import { apiClient } from './client';

/**
 * Volume stats per muscle group for current vs previous week
 */
export interface VolumeStats {
  [muscleGroup: string]: {
    current: number;
    previous: number;
  };
}

/**
 * Fetch dashboard summary with aggregated metrics
 * @returns Promise<DashboardSummary> with todayCalories, weeklyWorkouts, activeMinutes, nextWorkout
 * @throws ApiError if request fails
 */
export async function getSummary(): Promise<DashboardSummary> {
  // Resolved per-call, never hoisted to module scope: a module-scope const
  // would freeze the browser's zone at import time instead of read time.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params = new URLSearchParams({ tz });
  // FIX: Era '/dashboard/summary', el endpoint real es '/dashboard'
  const url = buildApiUrl(`/dashboard?${params.toString()}`);

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = await response.json();
    // Backend shape: { data: { todayCalories, weeklyWorkouts, activeMinutes, nextWorkout } }
    return (result?.data ?? result) as DashboardSummary;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Fetch volume analytics per muscle group (current week vs previous week)
 * @returns Promise<VolumeStats> grouped by muscle category
 * @throws ApiError if request fails
 */
export async function getVolumeStats(): Promise<VolumeStats> {
  // Resolved per-call, never hoisted to module scope, same as getSummary above.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params = new URLSearchParams({ tz });
  const url = buildApiUrl(`/dashboard/stats/volume?${params.toString()}`);

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = await response.json();
    // Backend shape: { data: { PECHO: { current, previous }, ... } }
    return (result?.data ?? result) as VolumeStats;
  } catch (error) {
    throw handleApiError(error);
  }
}

export const dashboardService = {
  getSummary,
  getVolumeStats,
};
