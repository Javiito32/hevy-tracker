/**
 * Set-level strength arithmetic.
 *
 * Every number the app reasons about — weekly volume, plateau slopes, personal
 * records — is an aggregate of what happens here, so a bias introduced in this
 * file propagates everywhere and is invisible downstream.
 */

/** The set types Hevy reports on every logged set. */
export type SetType = 'normal' | 'warmup' | 'dropset' | 'failure'

/**
 * A logged set, as stored in `Workout.exercises_summary`.
 * The Hevy payload uses `weight_kg` / `duration_seconds`; the stored summary
 * uses `weight` / `duration_seconds`. Callers normalise before getting here.
 */
export interface LoggedSet {
  type?: string | null
  weight?: number | null
  reps?: number | null
  rpe?: number | null
  duration_seconds?: number | null
  distance_meters?: number | null
}

/**
 * True when the set counts as effective work.
 *
 * Only 'warmup' is excluded: a drop set and a set taken to failure are both
 * effective work — a set past failure is arguably the most stimulating one in
 * the exercise. Sets synced before the type was persisted have no `type` at
 * all; those are treated as working sets, which is what they were assumed to be.
 */
export const isWorkingSet = (set: { type?: string | null } | null | undefined): boolean =>
  (set?.type ?? 'normal') !== 'warmup';

/**
 * Calculates the total volume (weight x reps) for a given set.
 * Bodyweight exercises log weight 0, which correctly contributes no tonnage.
 */
export const calcSetVolume = (weight: number | null | undefined, reps: number | null | undefined): number => {
  return (weight || 0) * (reps || 0);
};

/**
 * Above this many reps an estimated 1RM stops being an estimate and becomes an
 * extrapolation: Epley reads 166 kg from 100 kg x 20, a number the athlete has
 * never been near. Past the cap we report nothing rather than a confident lie.
 */
export const MAX_E1RM_REPS = 12;

/**
 * Percentage of 1RM attainable for N reps taken to true failure.
 *
 * A lookup table rather than a formula because every closed-form estimate
 * (Epley, Brzycki) drifts at the ends of the range; these are the values the
 * RPE/RIR charts in common use are built on.
 */
const PCT_1RM_BY_REPS_TO_FAILURE: Record<number, number> = {
  1: 100.0, 2: 95.5, 3: 92.2, 4: 89.2, 5: 86.3, 6: 83.7,
  7: 81.1, 8: 78.6, 9: 76.2, 10: 73.9, 11: 70.7, 12: 68.0
};

/**
 * Estimates 1RM using Epley's formula: 1RM = w * (1 + r/30).
 *
 * Used only when the set carries no RPE — without it we cannot know how close
 * to failure the set was, and Epley implicitly assumes it was taken there.
 * Returns null above MAX_E1RM_REPS.
 */
export const calcEstimated1RM = (weight: number | null | undefined, reps: number | null | undefined): number | null => {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  if (reps > MAX_E1RM_REPS) return null;
  if (reps === 1) return weight;

  const estimated = weight * (1 + reps / 30);
  return Math.round(estimated * 2) / 2; // nearest 0.5 kg
};

/**
 * Estimates 1RM from a set taken with reps in reserve.
 *
 * A set of 8 at RPE 6 leaves 4 reps in the tank, so it represents the same 1RM
 * as a set of 12 to failure — treating it as a maximal 8 would understate the
 * athlete's strength by roughly 10%. This is why the RPE is stored per set.
 *
 * Returns null when reps + RIR exceeds the table: the further past ~12 total
 * reps, the less any 1RM estimate means.
 */
export const calcE1RMWithRPE = (
  weight: number | null | undefined,
  reps: number | null | undefined,
  rpe: number | null | undefined
): number | null => {
  if (!weight || !reps || weight <= 0 || reps <= 0) return null;
  if (rpe == null || rpe <= 0 || rpe > 10) return null;

  const repsInReserve = Math.max(0, 10 - rpe);
  // Half-point RPEs (8.5) yield fractional RIR; round to the nearest whole rep
  // because the table is indexed by reps, not by fractions of one.
  const repsToFailure = Math.round(reps + repsInReserve);
  if (repsToFailure < 1 || repsToFailure > MAX_E1RM_REPS) return null;

  const pct = PCT_1RM_BY_REPS_TO_FAILURE[repsToFailure];
  if (!pct) return null;

  return Math.round((weight / (pct / 100)) * 2) / 2; // nearest 0.5 kg
};

/**
 * Best available 1RM estimate for a set: RPE-corrected when the RPE is there,
 * Epley otherwise. Warm-up sets never produce one — a light single at RPE 4 is
 * not evidence of a max.
 */
export const calcSetE1RM = (set: LoggedSet): number | null => {
  if (!isWorkingSet(set)) return null;
  return calcE1RMWithRPE(set.weight, set.reps, set.rpe) ?? calcEstimated1RM(set.weight, set.reps);
};

/**
 * Calculates the average RPE across sets that recorded one.
 *
 * Warm-up sets are excluded: they are logged at low RPE by definition, so
 * including them drags the session average down in proportion to how
 * thoroughly the athlete warmed up — the opposite of a fatigue signal.
 */
export const calcAverageRPE = (sets: LoggedSet[]): number | null => {
  const rpeSets = sets.filter(s => isWorkingSet(s) && s.rpe != null && s.rpe > 0);
  if (rpeSets.length === 0) return null;

  const sum = rpeSets.reduce((acc, curr) => acc + (curr.rpe as number), 0);
  return Math.round((sum / rpeSets.length) * 10) / 10;
};

export interface ExerciseSetSummary {
  /** Sets that count as effective work (everything but warm-ups). */
  workingSets: number
  /** Every set logged, warm-ups included. */
  totalSets: number
  /** Tonnage from working sets only — the figure the app reports as "volume". */
  volume: number
  /** Tonnage from warm-up sets, kept separate rather than discarded. */
  warmupVolume: number
  bestE1RM: number | null
  topSetWeight: number | null
  topSetReps: number | null
  avgRPE: number | null
  totalDurationSeconds: number | null
  totalDistanceMeters: number | null
}

/**
 * Reduces one exercise's sets to the fields stored on it.
 *
 * Shared by the sync and the admin recalculation so the two can never disagree
 * about what a workout's volume is.
 */
export function summarizeSets(sets: LoggedSet[]): ExerciseSetSummary {
  let volume = 0;
  let warmupVolume = 0;
  let workingSets = 0;
  let bestE1RM: number | null = null;
  let topSetWeight: number | null = null;
  let topSetReps: number | null = null;
  let duration = 0;
  let distance = 0;

  for (const set of sets) {
    const setVolume = calcSetVolume(set.weight, set.reps);

    if (isWorkingSet(set)) {
      workingSets++;
      volume += setVolume;

      const e1rm = calcSetE1RM(set);
      if (e1rm != null && (bestE1RM == null || e1rm > bestE1RM)) bestE1RM = e1rm;

      // The top set is the heaviest working set, with reps as the tiebreaker —
      // 100x8 is a better top set than 100x5.
      const w = set.weight ?? 0;
      const r = set.reps ?? 0;
      if (w > 0 && (topSetWeight == null || w > topSetWeight || (w === topSetWeight && r > (topSetReps ?? 0)))) {
        topSetWeight = w;
        topSetReps = r || null;
      }
    } else {
      warmupVolume += setVolume;
    }

    if (set.duration_seconds) duration += set.duration_seconds;
    if (set.distance_meters) distance += set.distance_meters;
  }

  return {
    workingSets,
    totalSets: sets.length,
    volume,
    warmupVolume,
    bestE1RM,
    topSetWeight,
    topSetReps,
    avgRPE: calcAverageRPE(sets),
    totalDurationSeconds: duration > 0 ? duration : null,
    totalDistanceMeters: distance > 0 ? distance : null
  };
}
