/**
 * Exercise Service
 * Handles exercise-related API calls
 * 
 * Note: All requests automatically handle 401 responses with token refresh
 * and retry via apiClient wrapper. See lib/api/client.ts for details.
 */

import { buildApiUrl } from './config';
import { apiClient } from './client';
import { Exercise } from '../types/api.types';
import { handleApiError } from './error.handler';

/**
 * Fetch all available exercises
 * @returns Promise<Exercise[]> list of available exercises
 * @throws ApiError if request fails
 */
export async function getAll(): Promise<Exercise[]> {
  const url = buildApiUrl('/exercises');

  try {
    // Use apiClient for automatic 401 handling and retry
    const response = await apiClient(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const data = await response.json();

    // Handle both direct array and wrapped response
    const exercises = Array.isArray(data) ? data : data.data || [];
    return exercises as Exercise[];
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Fetch exercises by muscle group
 * @param muscleGroup - Muscle group filter (e.g., 'PECHO', 'ESPALDA')
 * @returns Promise<Exercise[]> exercises matching the muscle group
 * @throws ApiError if request fails
 */
export async function getByMuscleGroup(muscleGroup: string): Promise<Exercise[]> {
  const url = buildApiUrl(`/exercises?muscleGroup=${encodeURIComponent(muscleGroup)}`);

  try {
    // Use apiClient for automatic 401 handling and retry
    const response = await apiClient(url, {
      method: 'GET',
    });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const data = await response.json();

    // Handle both direct array and wrapped response
    const exercises = Array.isArray(data) ? data : data.data || [];
    return exercises as Exercise[];
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Create a new exercise
 */
export async function create(data: { name: string, category: string }): Promise<Exercise> {
  const url = buildApiUrl('/exercises');
  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw handleApiError({}, response.status);
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

export const exerciseService = {
  getAll,
  getByMuscleGroup,
  create,
};
