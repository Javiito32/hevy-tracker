import { prisma } from './prisma'
import {
  PRIMARY_SET_WEIGHT, SECONDARY_SET_WEIGHT, VOLUME_LANDMARKS,
  classifyWeeklyVolume, muscleLabel, parseSecondaryMuscles, type VolumeVerdict
} from './muscle-groups'

/**
 * Weekly working sets per muscle group — the metric that replaces tonnage as
 * the primary hypertrophy signal.
 *
 * Tonnage answers "how much did I move", which rises when you add a leg day and
 * says nothing about whether chest was trained enough. Sets per muscle per week
 * is the variable the training literature actually prescribes against.
 */

/** Monday-based week key in LOCAL time — "which week did this land in" is a question about the athlete's calendar, not UTC. */
export function weekKey(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  d.setHours(0, 0, 0, 0)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function weekKeysBetween(from: Date, to: Date): string[] {
  const keys: string[] = []
  const cursor = new Date(from)
  cursor.setHours(12, 0, 0, 0)
  const end = new Date(to)
  // Emits every week in the span including empty ones: a chart that skips quiet
  // weeks compresses them away and overstates how consistent the block was.
  while (cursor <= end) {
    const k = weekKey(cursor)
    if (!keys.includes(k)) keys.push(k)
    cursor.setDate(cursor.getDate() + 7)
  }
  const lastKey = weekKey(end)
  if (!keys.includes(lastKey)) keys.push(lastKey)
  return keys
}

export interface MuscleWeekCell {
  muscle: string
  label: string
  /** Weighted sets: primary movers count 1, secondary 0.5. */
  sets: number
  /** Sets where this muscle was the primary mover. */
  primary_sets: number
  volume_kg: number
  verdict: VolumeVerdict
}

export interface MuscleVolumeWeek {
  week: string
  total_sets: number
  sessions: number
  muscles: MuscleWeekCell[]
}

export interface MuscleVolumeReport {
  weeks: MuscleVolumeWeek[]
  /** Averaged over the weeks in range, which is what a landmark compares against. */
  averages: Array<{
    muscle: string
    label: string
    avg_sets: number
    verdict: VolumeVerdict
    landmarks: { mev: number; mav: number; mrv: number } | null
  }>
  /** Exercises with no template and no override — their sets are in no bucket. */
  unclassified: Array<{ name: string; sets: number }>
  /** How much of the range's work could be attributed at all. */
  coverage: { classified_sets: number; total_sets: number }
}

interface ResolvedMuscles {
  primary: string | null
  secondary: string[]
}

/**
 * Resolves an exercise to muscle groups: catalogue template first, then the
 * user's manual override, then nothing.
 *
 * Overrides are keyed by name because an unresolvable exercise has no template
 * id left to key on — that is the whole reason the override table exists.
 */
export function buildMuscleResolver(
  templates: Array<{ id: string; primary_muscle_group: string; secondary_muscle_groups: string }>,
  overrides: Array<{ exercise_name: string; primary_muscle_group: string; secondary_muscle_groups: string }>
) {
  const byId = new Map(templates.map(t => [t.id, {
    primary: t.primary_muscle_group,
    secondary: parseSecondaryMuscles(t.secondary_muscle_groups)
  }]))
  const byName = new Map(overrides.map(o => [o.exercise_name.toLowerCase(), {
    primary: o.primary_muscle_group,
    secondary: parseSecondaryMuscles(o.secondary_muscle_groups)
  }]))

  return (templateId: string | null, name: string): ResolvedMuscles => {
    if (templateId) {
      const hit = byId.get(templateId)
      if (hit) return hit
    }
    return byName.get(name.toLowerCase()) ?? { primary: null, secondary: [] }
  }
}

export async function buildMuscleVolumeReport(
  userId: string,
  weeksBack = 8
): Promise<MuscleVolumeReport> {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - weeksBack * 7)
  from.setHours(0, 0, 0, 0)

  const [exercises, templates, overrides] = await Promise.all([
    prisma.workoutExercise.findMany({
      where: { user_id: userId, date: { gte: from, lte: to } },
      select: {
        name: true, date: true, working_sets: true, total_volume: true,
        exercise_template_id: true, workout_id: true
      }
    }),
    prisma.exerciseTemplate.findMany({
      select: { id: true, primary_muscle_group: true, secondary_muscle_groups: true }
    }),
    prisma.exerciseMuscleOverride.findMany({
      where: { user_id: userId },
      select: { exercise_name: true, primary_muscle_group: true, secondary_muscle_groups: true }
    })
  ])

  const resolve = buildMuscleResolver(templates, overrides)

  const weekMap = new Map<string, {
    muscles: Map<string, { sets: number; primary: number; volume: number }>
    workouts: Set<string>
    totalSets: number
  }>()
  for (const key of weekKeysBetween(from, to)) {
    weekMap.set(key, { muscles: new Map(), workouts: new Set(), totalSets: 0 })
  }

  const unclassified = new Map<string, number>()
  let classifiedSets = 0
  let totalSets = 0

  for (const ex of exercises) {
    const key = weekKey(ex.date)
    const bucket = weekMap.get(key)
    if (!bucket) continue

    bucket.workouts.add(ex.workout_id)
    bucket.totalSets += ex.working_sets
    totalSets += ex.working_sets

    const { primary, secondary } = resolve(ex.exercise_template_id, ex.name)
    if (!primary) {
      unclassified.set(ex.name, (unclassified.get(ex.name) ?? 0) + ex.working_sets)
      continue
    }
    classifiedSets += ex.working_sets

    const add = (muscle: string, weight: number, isPrimary: boolean) => {
      const cur = bucket.muscles.get(muscle) ?? { sets: 0, primary: 0, volume: 0 }
      cur.sets += ex.working_sets * weight
      if (isPrimary) {
        cur.primary += ex.working_sets
        // Tonnage is attributed to the primary mover only. Splitting it across
        // secondaries would make the muscle volumes sum to more than the
        // session actually moved.
        cur.volume += ex.total_volume
      }
      bucket.muscles.set(muscle, cur)
    }

    add(primary, PRIMARY_SET_WEIGHT, true)
    for (const s of secondary) {
      if (s !== primary) add(s, SECONDARY_SET_WEIGHT, false)
    }
  }

  const weeks: MuscleVolumeWeek[] = [...weekMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, bucket]) => ({
      week,
      sessions: bucket.workouts.size,
      total_sets: bucket.totalSets,
      muscles: [...bucket.muscles.entries()]
        .map(([muscle, v]) => ({
          muscle,
          label: muscleLabel(muscle),
          sets: Math.round(v.sets * 10) / 10,
          primary_sets: v.primary,
          volume_kg: Math.round(v.volume),
          verdict: classifyWeeklyVolume(muscle, v.sets)
        }))
        .sort((a, b) => b.sets - a.sets)
    }))

  // Averages are taken over weeks that had any training at all. Including a
  // week the athlete was on holiday would halve every average and manufacture
  // an "under MEV" verdict out of a break they took deliberately.
  const activeWeeks = weeks.filter(w => w.sessions > 0)
  const totals = new Map<string, number>()
  for (const w of activeWeeks) {
    for (const m of w.muscles) totals.set(m.muscle, (totals.get(m.muscle) ?? 0) + m.sets)
  }

  const averages = [...totals.entries()]
    .map(([muscle, sum]) => {
      const avg = activeWeeks.length ? sum / activeWeeks.length : 0
      return {
        muscle,
        label: muscleLabel(muscle),
        avg_sets: Math.round(avg * 10) / 10,
        verdict: classifyWeeklyVolume(muscle, avg),
        landmarks: VOLUME_LANDMARKS[muscle] ?? null
      }
    })
    .sort((a, b) => b.avg_sets - a.avg_sets)

  return {
    weeks,
    averages,
    unclassified: [...unclassified.entries()]
      .map(([name, sets]) => ({ name, sets }))
      .sort((a, b) => b.sets - a.sets),
    coverage: { classified_sets: classifiedSets, total_sets: totalSets }
  }
}
