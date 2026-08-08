import { prisma } from './prisma'
import { calcSetE1RM } from './volume-calculator'
import type { ExerciseSummary } from './workout-metrics'

/**
 * Writes the normalised `WorkoutExercise` / `ExerciseSet` rows for a workout.
 *
 * Called by the sync and by the rebuild job, which is why it replaces rather
 * than merges: a workout edited in Hevy can lose an exercise, and a merge would
 * leave the deleted one behind forever.
 */
export async function writeWorkoutExercises(
  workoutId: string,
  userId: string,
  date: Date,
  summary: ExerciseSummary[]
): Promise<void> {
  // Cascade removes the sets; doing it in one transaction with the insert stops
  // a crash mid-write from leaving a workout with no exercises at all.
  await prisma.$transaction([
    prisma.workoutExercise.deleteMany({ where: { workout_id: workoutId } }),
    ...summary.map((ex, index) =>
      prisma.workoutExercise.create({
        data: {
          workout_id: workoutId,
          user_id: userId,
          date,
          // Only link templates that exist: Hevy reports ids for exercises the
          // catalogue may not have yet (a custom one, or a stale sync). A
          // dangling FK would fail the whole insert, so resolution happens in
          // linkTemplates() afterwards.
          exercise_template_id: null,
          name: ex.name,
          order_index: index,
          superset_id: ex.superset_id,
          working_sets: ex.working_sets,
          total_sets: ex.sets,
          total_volume: ex.total_volume,
          best_e1rm: ex.estimated_1rm,
          top_set_weight: ex.top_set_weight,
          top_set_reps: ex.top_set_reps,
          avg_rpe: ex.avg_rpe,
          sets: {
            create: ex.sets_details.map((s, i) => ({
              order_index: i,
              set_type: s.type ?? 'normal',
              weight_kg: s.weight,
              reps: s.reps,
              rpe: s.rpe,
              distance_meters: s.distance_meters,
              duration_seconds: s.duration_seconds,
              e1rm: calcSetE1RM({
                type: s.type,
                weight: s.weight,
                reps: s.reps,
                rpe: s.rpe
              })
            }))
          }
        }
      })
    )
  ])

  await linkTemplates(workoutId, userId, summary)
}

/**
 * Attaches each written exercise to its catalogue template.
 *
 * Split from the insert because the template may not exist: the link is
 * best-effort and re-runnable, so syncing the catalogue later and re-running
 * this fills in what was missing without touching the workout data.
 */
export async function linkTemplates(
  workoutId: string,
  userId: string,
  summary: ExerciseSummary[]
): Promise<{ linked: number; unresolved: string[] }> {
  const ids = [...new Set(summary.map(e => e.exercise_template_id).filter(Boolean))] as string[]
  if (ids.length === 0) {
    return { linked: 0, unresolved: summary.map(e => e.name) }
  }

  const known = await prisma.exerciseTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true }
  })
  const knownIds = new Set(known.map(t => t.id))

  const rows = await prisma.workoutExercise.findMany({
    where: { workout_id: workoutId },
    select: { id: true, order_index: true }
  })

  let linked = 0
  const unresolved: string[] = []

  for (const row of rows) {
    const ex = summary[row.order_index]
    if (!ex) continue
    if (ex.exercise_template_id && knownIds.has(ex.exercise_template_id)) {
      await prisma.workoutExercise.update({
        where: { id: row.id },
        data: { exercise_template_id: ex.exercise_template_id }
      })
      linked++
    } else {
      unresolved.push(ex.name)
    }
  }

  return { linked, unresolved }
}

/**
 * Exercises the user has logged that no template resolves — what the admin
 * "ejercicios sin clasificar" panel lists. An override already assigned counts
 * as resolved even though the template link is still null.
 */
export async function findUnclassifiedExercises(userId: string): Promise<Array<{
  name: string
  sessions: number
  last_date: Date
  has_override: boolean
}>> {
  const rows = await prisma.workoutExercise.groupBy({
    by: ['name'],
    where: { user_id: userId, exercise_template_id: null },
    _count: { _all: true },
    _max: { date: true }
  })

  if (rows.length === 0) return []

  const overrides = await prisma.exerciseMuscleOverride.findMany({
    where: { user_id: userId, exercise_name: { in: rows.map(r => r.name) } },
    select: { exercise_name: true }
  })
  const overridden = new Set(overrides.map(o => o.exercise_name))

  return rows
    .map(r => ({
      name: r.name,
      sessions: r._count._all,
      last_date: r._max.date ?? new Date(0),
      has_override: overridden.has(r.name)
    }))
    .sort((a, b) => b.sessions - a.sessions)
}
