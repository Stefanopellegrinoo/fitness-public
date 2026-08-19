/**
 * Routine Service
 * Handles routine CRUD operations
 * 
 * Note: All requests automatically handle 401 responses with token refresh
 * and retry via apiClient wrapper. See lib/api/client.ts for details.
 */

import { buildApiUrl } from './config';
import { apiClient } from './client';
import { Routine, CreateRoutinePayload, RoutineDaySummary } from '../types/api.types';
import { handleApiError } from './error.handler';

/**
 * Fetch all routines
 * @returns Promise<Routine[]> list of user's routines
 * @throws ApiError if request fails
 */
export async function getAll(): Promise<Routine[]> {
  const url = buildApiUrl('/routines');

  try {
    const response = await apiClient(url, {
      method: 'GET',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }

    const data = await response.json();
    return (data.data || data) as Routine[];
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Fetch a single routine by ID
 * @param id - Routine ID
 * @returns Promise<Routine> routine details
 * @throws ApiError if request fails
 */
export async function getById(id: string): Promise<Routine> {
  const url = buildApiUrl(`/routines/${id}`);

  try {
    const response = await apiClient(url, {
      method: 'GET',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }

    const data = await response.json();
    return (data.data || data) as Routine;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Create a new routine
 * @param routineData - Routine creation payload
 * @returns Promise<Routine> created routine with server-assigned id
 * @throws ApiError if creation fails
 */
export async function create(routineData: CreateRoutinePayload): Promise<Routine> {
  const url = buildApiUrl('/routines');

  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify(routineData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }

    const data = await response.json();
    return (data.data || data) as Routine;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Update an existing routine
 * @param id - Routine ID to update
 * @param routineData - Routine update payload
 * @returns Promise<Routine> updated routine
 * @throws ApiError if update fails
 */
export async function update(
  id: string,
  routineData: Partial<CreateRoutinePayload>
): Promise<Routine> {
  const url = buildApiUrl(`/routines/${id}`);

  try {
    const response = await apiClient(url, {
      method: 'PUT',
      body: JSON.stringify(routineData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }

    const data = await response.json();
    return (data.data || data) as Routine;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Delete a routine
 * @param id - Routine ID to delete
 * @throws ApiError if deletion fails
 */
export async function deleteRoutine(id: string): Promise<void> {
  const url = buildApiUrl(`/routines/${id}`);

  try {
    const response = await apiClient(url, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * The day this routine suggests training next.
 *
 * The rotation is anchored on the last session that actually logged a set, so
 * the answer is "you did Push, now Pull" and not merely "today is Thursday".
 * That history lives on the server, which is why this is a request and not a
 * calculation: the client only knows the days, never what was trained.
 *
 * `null` when the routine has no days — a routine with nothing in it has no
 * next day, and that is an answer rather than an error.
 */
export async function getNextDay(id: string): Promise<RoutineDaySummary | null> {
  // Resolved per call, never at module scope: hoisting it would freeze the
  // browser's zone at import time instead of read time. The weekday that
  // anchors the rotation is the CALLER's — same instant, two zones, two
  // answers — and this route is the seventh on the `?tz=` contract.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const url = buildApiUrl(`/routines/${encodeURIComponent(id)}/next-day?tz=${encodeURIComponent(tz)}`);

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (!response.ok) {
      // The body, not `{}`: it carries the server's own message, and
      // `apiErrorStatus` only trusts a status that arrived with one.
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }

    const result = await response.json();
    return (result.data ?? null) as RoutineDaySummary | null;
  } catch (error) {
    throw handleApiError(error);
  }
}

export const routineService = {
  getAll,
  getById,
  create,
  update,
  delete: deleteRoutine,
  getNextDay,
};
