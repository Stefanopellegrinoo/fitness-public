import { buildApiUrl } from './config';
import { handleApiError } from './error.handler';
import { apiClient } from './client';

export interface ProgressionSet {
  setNumber: number;
  weightKg: number;
  reps: number;
  setType: string;
}

export interface ProgressionPoint {
  sessionId: string;
  date: string;
  topSetWeight: number | null;
  e1rm: number | null;
  volume: number;
  sets: ProgressionSet[];
}

export interface WeightPR {
  weightKg: number;
  reps: number;
  date: string;
  sessionId: string;
}

export interface ExercisePRs {
  weightPRs: WeightPR[];
  e1rmPRs: Array<WeightPR & { e1rm: number }>;
  repPRs: Array<{ weightKg: number; reps: number; date: string; sessionId: string }>;
}

/**
 * One point per session the user trained this exercise, oldest first, each
 * carrying its own sets. `limit` keeps the most RECENT sessions.
 */
export async function getExerciseProgression(
  exerciseId: string,
  limit?: number
): Promise<ProgressionPoint[]> {
  // The id is a path SEGMENT, so it is encoded rather than interpolated: a
  // value carrying `/` or `?` would otherwise rewrite the route instead of
  // filling it in.
  const path = `/stats/exercises/${encodeURIComponent(exerciseId)}/progression`;
  const url = buildApiUrl(limit === undefined ? path : `${path}?limit=${limit}`);
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
 * Personal records across the exercise's WHOLE history, which is why this is a
 * separate call: the progression above is capped at its most recent sessions,
 * so a record set before that window would be missing from it.
 */
export async function getExercisePRs(exerciseId: string): Promise<ExercisePRs> {
  const url = buildApiUrl(`/stats/exercises/${encodeURIComponent(exerciseId)}/prs`);
  try {
    const response = await apiClient(url, { method: 'GET' });
    if (!response.ok) throw handleApiError({}, response.status);
    const result = await response.json();
    // Empty lists rather than undefined: every caller reduces over these, and a
    // missing key throws inside the render instead of showing "no PRs yet".
    return {
      weightPRs: result.data?.weightPRs || [],
      e1rmPRs: result.data?.e1rmPRs || [],
      repPRs: result.data?.repPRs || [],
    };
  } catch (error) {
    throw handleApiError(error);
  }
}
