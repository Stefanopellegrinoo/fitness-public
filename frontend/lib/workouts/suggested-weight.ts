import type { PlannedSet } from '@/lib/types/api.types';

const roundToHalf = (kg: number): number => Math.round(kg * 2) / 2;

/**
 * Suggested working weight for a planned set.
 * - Explicit targetWeightKg wins.
 * - Else percentOfTopSet × the heaviest logged non-warmup weight so far (dynamic).
 * - Else undefined (no suggestion / no reference yet).
 */
export function computeSuggestedWeight(
  plan: PlannedSet,
  heaviestLoggedNonWarmupKg: number | null,
): number | undefined {
  if (plan.targetWeightKg != null) return plan.targetWeightKg;
  if (plan.percentOfTopSet != null && heaviestLoggedNonWarmupKg != null) {
    return roundToHalf((plan.percentOfTopSet / 100) * heaviestLoggedNonWarmupKg);
  }
  return undefined;
}
