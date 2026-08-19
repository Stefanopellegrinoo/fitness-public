/**
 * Body Metrics Service
 * Handles body composition tracking (weight, muscle mass, fat mass)
 *
 * FIX (2026-04-08): Endpoint corregido de '/metrics' → '/body-metrics'
 * El backend monta este router en /api/body-metrics (ver app.ts línea 72)
 *
 * Schema del backend (body-metrics.routes.ts):
 *   POST /api/body-metrics { weightKg?, muscleMassKg?, fatMassKg?, notes? }
 *   GET  /api/body-metrics  → { data: BodyMetric[], pagination }
 *
 * Nota: Al menos uno de weightKg, muscleMassKg, fatMassKg es requerido en el POST.
 */

import { buildApiUrl } from './config';
import { BodyMetric } from '../types/api.types';
import { handleApiError } from './error.handler';
import { apiClient } from './client';

/**
 * Fetch user body metrics history
 * @param limit - Number of records to fetch (default: 50)
 * @param offset - Pagination offset (default: 0)
 * @returns Promise<BodyMetric[]> metrics sorted by date desc
 * @throws ApiError if request fails
 */
export async function getUserMetrics(
  limit: number = 50,
  offset: number = 0
): Promise<BodyMetric[]> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString(),
  });

  // FIX: Era '/metrics', el backend está montado en '/body-metrics'
  const url = buildApiUrl(`/body-metrics?${params.toString()}`);

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const data = await response.json();
    // Backend returns { data: [...], pagination: {} }
    const metrics = Array.isArray(data) ? data : data.data || [];
    return metrics as BodyMetric[];
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Record a new body metric entry
 * @param metricData - Metric data fields (at least one required)
 * @returns Promise<BodyMetric> created metric with server-assigned id
 * @throws ApiError if creation fails
 */
export async function recordMetric(metricData: {
  weightKg?: number;
  muscleMassKg?: number;
  fatMassKg?: number;
  chestCm?: number;
  waistCm?: number;
  hipCm?: number;
  leftArmCm?: number;
  rightArmCm?: number;
  leftThighCm?: number;
  rightThighCm?: number;
  leftCalfCm?: number;
  rightCalfCm?: number;
  notes?: string;
  date?: string;
}): Promise<BodyMetric> {
  const url = buildApiUrl('/body-metrics');

  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify(metricData),
    });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const data = await response.json();
    return (data.data || data) as BodyMetric;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Calculate weight trend for date range
 * @param metrics - Array of metric entries
 * @param count - Number of records to use for trend (default: 7)
 * @returns Weight change in kg or null if insufficient data
 */
export function calculateWeightTrend(
  metrics: BodyMetric[],
  count: number = 7
): number | null {
  const withWeight = metrics.filter((m) => m.weightKg != null);
  if (withWeight.length < 2) return null;

  const sorted = [...withWeight].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const slice = sorted.slice(-count);
  if (slice.length < 2) return null;

  const earliest = slice[0].weightKg!;
  const latest = slice[slice.length - 1].weightKg!;

  return latest - earliest;
}

export const metricsService = {
  getUserMetrics,
  recordMetric,
  calculateWeightTrend,
};
