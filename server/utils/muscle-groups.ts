/**
 * The muscle-group vocabulary, taken verbatim from Hevy's API enum so no
 * translation layer can drift. Labels and volume landmarks live here too —
 * `app/utils/training.ts` mirrors the labels for the frontend, keep the two in
 * sync the way nutrition.ts mirrors nutrition-calculator.ts.
 */

export const MUSCLE_GROUPS = [
  'chest', 'lats', 'upper_back', 'traps', 'lower_back', 'shoulders',
  'biceps', 'triceps', 'forearms', 'abdominals',
  'quadriceps', 'hamstrings', 'glutes', 'calves', 'abductors', 'adductors',
  'neck', 'cardio', 'full_body', 'other'
] as const

export type MuscleGroup = typeof MUSCLE_GROUPS[number]

export const MUSCLE_LABELS: Record<string, string> = {
  chest: 'Pecho',
  lats: 'Dorsal',
  upper_back: 'Espalda alta',
  traps: 'Trapecio',
  lower_back: 'Lumbar',
  shoulders: 'Hombros',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  forearms: 'Antebrazos',
  abdominals: 'Abdomen',
  quadriceps: 'Cuádriceps',
  hamstrings: 'Isquios',
  glutes: 'Glúteos',
  calves: 'Gemelos',
  abductors: 'Abductores',
  adductors: 'Aductores',
  neck: 'Cuello',
  cardio: 'Cardio',
  full_body: 'Cuerpo completo',
  other: 'Otros'
}

/**
 * Groups that carry a hypertrophy set target. Excluded are the ones where
 * counting weekly sets is meaningless: `cardio` isn't resistance work, and
 * `full_body` / `other` are catch-alls whose sets belong to no single muscle.
 */
export const TRAINABLE_MUSCLE_GROUPS: MuscleGroup[] = MUSCLE_GROUPS.filter(
  g => g !== 'cardio' && g !== 'full_body' && g !== 'other'
) as MuscleGroup[]

export interface VolumeLandmarks {
  /** Minimum Effective Volume — below this, weekly sets likely maintain at best. */
  mev: number
  /** Maximum Adaptive Volume — the productive middle of the range. */
  mav: number
  /** Maximum Recoverable Volume — above this, fatigue outruns adaptation. */
  mrv: number
}

/**
 * Weekly working sets per muscle group.
 *
 * These are population-level starting points, not prescriptions: individual
 * tolerance varies enough that the app presents them as bands to read against,
 * never as a target to hit. They deliberately sit on the conservative side —
 * telling someone they are under-training when they are not is the more
 * expensive error, because it invites adding volume they cannot recover from.
 */
export const VOLUME_LANDMARKS: Record<string, VolumeLandmarks> = {
  chest:       { mev: 8,  mav: 16, mrv: 22 },
  lats:        { mev: 10, mav: 18, mrv: 25 },
  upper_back:  { mev: 10, mav: 18, mrv: 25 },
  traps:       { mev: 4,  mav: 12, mrv: 20 },
  lower_back:  { mev: 4,  mav: 10, mrv: 16 },
  shoulders:   { mev: 8,  mav: 16, mrv: 24 },
  biceps:      { mev: 8,  mav: 14, mrv: 22 },
  triceps:     { mev: 6,  mav: 14, mrv: 20 },
  forearms:    { mev: 2,  mav: 8,  mrv: 16 },
  abdominals:  { mev: 4,  mav: 12, mrv: 20 },
  quadriceps:  { mev: 8,  mav: 16, mrv: 22 },
  hamstrings:  { mev: 6,  mav: 12, mrv: 20 },
  glutes:      { mev: 4,  mav: 12, mrv: 20 },
  calves:      { mev: 6,  mav: 14, mrv: 22 },
  abductors:   { mev: 2,  mav: 8,  mrv: 14 },
  adductors:   { mev: 2,  mav: 8,  mrv: 14 },
  neck:        { mev: 2,  mav: 6,  mrv: 12 }
}

/**
 * How much a set counts toward a muscle it trains.
 *
 * A primary mover gets the full set; a secondary gets half. The alternative —
 * counting every secondary as a whole set — inflates every total to the point
 * of uselessness: a bench press would read as a full set for chest, shoulders
 * AND triceps, and any push day would appear to blow past MRV on all three.
 * Half is a convention, not a measurement; it is applied consistently so the
 * comparison across weeks stays honest even if the absolute number is coarse.
 */
export const PRIMARY_SET_WEIGHT = 1
export const SECONDARY_SET_WEIGHT = 0.5

export const muscleLabel = (slug: string): string => MUSCLE_LABELS[slug] ?? slug

/** Where a weekly set count sits against the landmarks. */
export type VolumeVerdict = 'below_mev' | 'developmental' | 'optimal' | 'above_mrv' | 'unknown'

export function classifyWeeklyVolume(muscle: string, sets: number): VolumeVerdict {
  const lm = VOLUME_LANDMARKS[muscle]
  if (!lm) return 'unknown'
  if (sets < lm.mev) return 'below_mev'
  if (sets > lm.mrv) return 'above_mrv'
  if (sets >= lm.mav) return 'optimal'
  return 'developmental'
}

export function parseSecondaryMuscles(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter(m => typeof m === 'string') : []
  } catch {
    return []
  }
}
