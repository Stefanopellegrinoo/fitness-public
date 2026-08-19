import { buildApiUrl } from './config';
import { handleApiError } from './error.handler';
import { apiClient } from './client';
import type { SetType } from '@/lib/types/api.types';

// Every call below hands the PARSED error body to `handleApiError`: the backend
// distinguishes situations the caller acts on differently (409 "already finished"
// vs 404), and that only survives if the body travels with the status. The
// `.catch(() => ({}))` keeps a non-JSON body (proxy HTML, empty 502) from turning
// an HTTP error into a parse error — the repo pattern from auth/routine services.

export interface WorkoutSet {
  exerciseId: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  rpe?: number;
  isWarmup?: boolean;
  setType?: SetType;
}

export async function getActiveWorkout() {
  const url = buildApiUrl('/workouts/active');
  try {
    const response = await apiClient(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

// No `notes`: the endpoint declared it, dropped it, and now rejects it outright.
// Both call sites always passed `undefined`, so the key never reached the wire —
// but leaving the argument in place would keep a guaranteed 400 one keystroke away.
export async function startWorkout(routineId?: string, clientDay?: string, routineDayId?: string) {
  const url = buildApiUrl('/workouts/start');
  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify({ routineId, clientDay, routineDayId }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

export async function finishWorkout(sessionId: string) {
  const url = buildApiUrl(`/workouts/${sessionId}/finish`);
  try {
    const response = await apiClient(url, { method: 'POST' });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

export async function addWorkoutSet(sessionId: string, setData: WorkoutSet) {
  const url = buildApiUrl(`/workouts/${sessionId}/sets`);
  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify(setData),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

export async function linkExerciseToSession(sessionId: string, exerciseId: string) {
  const url = buildApiUrl(`/workouts/${sessionId}/exercises`);
  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify({ exerciseId }),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

export async function deleteWorkoutSet(setId: string) {
  const url = buildApiUrl(`/workouts/sets/${setId}`);
  try {
    const response = await apiClient(url, { method: 'DELETE' });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }
  } catch (error) {
    throw handleApiError(error);
  }
}

export async function updateWorkoutSet(setId: string, data: Partial<WorkoutSet>) {
  const url = buildApiUrl(`/workouts/sets/${setId}`);
  try {
    const response = await apiClient(url, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

export async function getExerciseHistory(exerciseId: string, currentSessionId?: string) {
  const query = currentSessionId ? `?currentSessionId=${currentSessionId}` : '';
  const url = buildApiUrl(`/workouts/history/exercise/${exerciseId}${query}`);
  try {
    const response = await apiClient(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

export async function getSessions(routineId?: string) {
  const query = routineId ? `?routineId=${routineId}` : '';
  const url = buildApiUrl(`/workouts/sessions${query}`);
  try {
    const response = await apiClient(url);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw handleApiError(errorData, response.status);
    }
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

export const workoutService = {
  getActiveWorkout,
  startWorkout,
  finishWorkout,
  addWorkoutSet,
  linkExerciseToSession,
  deleteWorkoutSet,
  updateWorkoutSet,
  getExerciseHistory,
  getSessions,
};
