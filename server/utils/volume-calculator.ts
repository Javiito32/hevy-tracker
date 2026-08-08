/**
 * The set types Hevy reports on every logged set.
 *
 * Only 'warmup' is excluded from effective work: a drop set and a set taken to
 * failure are both working sets, and a set past failure is arguably the most
 * stimulating one in the exercise.
 */
export type SetType = 'normal' | 'warmup' | 'dropset' | 'failure'

/**
 * True when the set counts as effective work.
 *
 * Sets synced before the type was persisted have no `type` at all; those are
 * treated as working sets, which is what they were assumed to be anyway.
 */
export const isWorkingSet = (set: { type?: string | null } | null | undefined): boolean =>
  (set?.type ?? 'normal') !== 'warmup';

/**
 * Calculates the total volume (weight x reps) for a given set.
 * If bodyweight exercise, assumes weight is 0 or user's bodyweight if provided.
 */
export const calcSetVolume = (weight: number, reps: number): number => {
  return (weight || 0) * (reps || 0);
};

/**
 * Estimates 1RM using Epley's formula: 1RM = w * (1 + r/30)
 * Only valid generally for reps <= 10, but widely used as an estimate.
 */
export const calcEstimated1RM = (weight: number, reps: number): number | null => {
  if (!weight || !reps || weight <= 0) return null;
  if (reps === 1) return weight;
  
  const estimated = weight * (1 + reps / 30);
  // Round to nearest 0.5kg
  return Math.round(estimated * 2) / 2;
};

/**
 * Calculates the average RPE for an entire exercise or session
 * taking into account only the sets where RPE is recorded.
 */
export const calcAverageRPE = (sets: any[]): number | null => {
  const rpeSets = sets.filter(s => s.rpe != null && s.rpe > 0);
  if (rpeSets.length === 0) return null;
  
  const sum = rpeSets.reduce((acc, curr) => acc + curr.rpe, 0);
  return Math.round((sum / rpeSets.length) * 10) / 10; // 1 decimal place
};
