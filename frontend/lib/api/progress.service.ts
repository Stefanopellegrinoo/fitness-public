import { buildApiUrl } from './config';
import { ApiResponse } from '../types/api.types';
import { handleApiError } from './error.handler';
import { apiClient } from './client';

export interface BodyProgressPoint {
  date: string;
  weight?: number;
  muscle?: number;
  fat?: number;
}

export interface WorkoutProgressPoint {
  date: string;
  volume: number;
  sessions: number;
  activeDays: number;
}

export interface NutritionProgressPoint {
  date: string;
  calories: number;
  protein: number;
}

/**
 * Fetch body composition history for charts
 * @param days - Number of days to fetch
 */
export async function getBodyProgress(days: number = 30): Promise<BodyProgressPoint[]> {
  // Resolved per-call, never hoisted to module scope (see dashboard.service.ts's
  // getSummary): a module-scope const would freeze the browser's zone at
  // import time instead of read time.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url = buildApiUrl(`/progress/body?days=${days}&tz=${encodeURIComponent(tz)}`);
  try {
    const response = await apiClient(url, { method: 'GET' });
    if (!response.ok) throw handleApiError({}, response.status);
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Fetch workout volume history for charts
 * @param weeks - Number of weeks to fetch
 */
export async function getWorkoutProgress(weeks: number = 12): Promise<WorkoutProgressPoint[]> {
  // Resolved per-call, never hoisted to module scope -- see getBodyProgress above.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url = buildApiUrl(`/progress/workouts?weeks=${weeks}&tz=${encodeURIComponent(tz)}`);
  try {
    const response = await apiClient(url, { method: 'GET' });
    if (!response.ok) throw handleApiError({}, response.status);
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Fetch nutrition averages history for charts
 * @param days - Number of days to fetch
 */
export async function getNutritionProgress(days: number = 30): Promise<NutritionProgressPoint[]> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url = buildApiUrl(`/progress/nutrition?days=${days}&tz=${encodeURIComponent(tz)}`);
  try {
    const response = await apiClient(url, { method: 'GET' });
    if (!response.ok) throw handleApiError({}, response.status);
    const result = await response.json();
    return result.data || [];
  } catch (error) {
    throw handleApiError(error);
  }
}

export const progressService = {
  getBodyProgress,
  getWorkoutProgress,
  getNutritionProgress
};
