import { summarizeSets, isWorkingSet, calcAverageRPE, type LoggedSet } from './volume-calculator'

/**
 * The single definition of "what a workout's numbers are".
 *
 * Both the Hevy sync and the admin recalculation job go through here. If either
 * computed volume on its own, pressing "recalcular métricas" would silently
 * rewrite the database with figures that differ from what the next sync
 * produces, and the two would take turns overwriting each other.
 *
 * Everything in this module is pure: it takes a raw Hevy workout payload (the
 * JSON stored verbatim in `Workout.raw_data`) and returns computed fields. No
 * database, no network — which is exactly what makes the backfill offline.
 */

/** One exercise as stored in `Workout.exercises_summary`. */
export interface ExerciseSummary {
  name: string
  type: 'strength' | 'cardio' | 'duration'
  /** Hevy's template id — the key that maps this exercise to a muscle group. */
  exercise_template_id: string | null
  /** Superset grouping, null when the exercise stands alone. */
  superset_id: number | null
  /** Every set logged, warm-ups included. Kept for display. */
  sets: number
  /** Sets that count as effective work. This is what volume analysis uses. */
  working_sets: number
  total_volume: number
  warmup_volume: number
  estimated_1rm: number | null
  top_set_weight: number | null
  top_set_reps: number | null
  avg_rpe: number | null
  total_duration_seconds: number | null
  total_distance_meters: number | null
  sets_details: StoredSet[]
}

export interface StoredSet {
  type: string
  weight: number | null
  reps: number | null
  rpe: number | null
  duration_seconds: number | null
  distance_meters: number | null
}

export interface WorkoutMetrics {
  /** Working-set tonnage. The figure the whole app calls "volume". */
  totalVolume: number
  /** Every set including warm-ups. Reported separately, never mixed in. */
  totalTonnage: number
  rpeAvg: number | null
  summary: ExerciseSummary[]
}

/** Hevy sends `weight_kg`; the stored summary uses `weight`. Accept both. */
function toLoggedSet(s: any): LoggedSet {
  return {
    type: s?.type ?? 'normal',
    weight: s?.weight_kg ?? s?.weight ?? null,
    reps: s?.reps ?? null,
    rpe: s?.rpe || null,
    duration_seconds: s?.duration_seconds ?? null,
    distance_meters: s?.distance_meters ?? null
  }
}

/**
 * Classifies an exercise by what its sets actually recorded rather than by the
 * template type, so an exercise logged with weight and reps is 'strength' even
 * if Hevy's template calls it something else.
 */
function classifyExercise(sets: LoggedSet[]): 'strength' | 'cardio' | 'duration' {
  const hasWeight = sets.some(s => (s.weight ?? 0) > 0)
  const hasReps = sets.some(s => (s.reps ?? 0) > 0)
  const hasDistance = sets.some(s => (s.distance_meters ?? 0) > 0)
  const hasDuration = sets.some(s => (s.duration_seconds ?? 0) > 0)
  if (hasWeight || hasReps) return 'strength'
  if (hasDistance) return 'cardio'
  if (hasDuration) return 'duration'
  return 'strength'
}

/**
 * Computes every stored field of a workout from its raw Hevy payload.
 *
 * Accepts either the API shape (`exercises[].sets[].weight_kg`) or an already
 * stored summary re-fed through it, so the recalculation job can run on rows
 * whose raw_data predates a field.
 */
export function buildWorkoutMetrics(raw: any): WorkoutMetrics {
  const exercises: any[] = Array.isArray(raw?.exercises) ? raw.exercises : []

  let totalVolume = 0
  let totalTonnage = 0
  const allSets: LoggedSet[] = []
  const summary: ExerciseSummary[] = []

  for (const ex of exercises) {
    const rawSets: any[] = Array.isArray(ex?.sets) ? ex.sets : []
    const sets = rawSets.map(toLoggedSet)
    allSets.push(...sets)

    const s = summarizeSets(sets)
    totalVolume += s.volume
    totalTonnage += s.volume + s.warmupVolume

    summary.push({
      name: ex?.title ?? ex?.name ?? 'Ejercicio',
      type: classifyExercise(sets),
      exercise_template_id: ex?.exercise_template_id ?? null,
      superset_id: ex?.supersets_id ?? ex?.superset_id ?? null,
      sets: s.totalSets,
      working_sets: s.workingSets,
      total_volume: s.volume,
      warmup_volume: s.warmupVolume,
      estimated_1rm: s.bestE1RM,
      top_set_weight: s.topSetWeight,
      top_set_reps: s.topSetReps,
      avg_rpe: s.avgRPE,
      total_duration_seconds: s.totalDurationSeconds,
      total_distance_meters: s.totalDistanceMeters,
      sets_details: sets.map(set => ({
        type: (set.type ?? 'normal') as string,
        weight: set.weight ?? null,
        reps: set.reps ?? null,
        rpe: set.rpe ?? null,
        duration_seconds: set.duration_seconds ?? null,
        distance_meters: set.distance_meters ?? null
      }))
    })
  }

  return {
    totalVolume,
    totalTonnage,
    // Averaged across the session's working sets, not across per-exercise
    // averages: an exercise with one set would otherwise weigh as much as one
    // with six.
    rpeAvg: calcAverageRPE(allSets),
    summary
  }
}

/**
 * Rebuilds metrics from a stored `exercises_summary` when `raw_data` is missing
 * or unparseable. Lossy by definition — it can only see what was stored — but
 * it keeps the recalculation job from skipping rows entirely.
 */
export function metricsFromStoredSummary(summaryJson: string | null): WorkoutMetrics | null {
  if (!summaryJson) return null
  let parsed: any[]
  try {
    parsed = JSON.parse(summaryJson)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  return buildWorkoutMetrics({
    exercises: parsed.map(ex => ({
      title: ex.name,
      exercise_template_id: ex.exercise_template_id ?? null,
      supersets_id: ex.superset_id ?? null,
      sets: (ex.sets_details ?? []).map((s: any) => ({
        type: s.type ?? 'normal',
        weight_kg: s.weight ?? null,
        reps: s.reps ?? null,
        rpe: s.rpe ?? null,
        duration_seconds: s.duration_seconds ?? null,
        distance_meters: s.distance_meters ?? null
      }))
    }))
  })
}

export { isWorkingSet }
