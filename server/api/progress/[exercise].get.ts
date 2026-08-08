import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

/**
 * Per-session history for one exercise, read from the normalised table.
 *
 * Records are joined in so the chart can mark the sessions that set one — a PR
 * is the single most legible point on a progression curve.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const exerciseName = decodeURIComponent(getRouterParam(event, 'exercise') ?? '')
  if (!exerciseName) throw createError({ statusCode: 400, message: 'Falta el nombre del ejercicio' })

  const [rows, records] = await Promise.all([
    prisma.workoutExercise.findMany({
      where: { user_id: userId, name: exerciseName },
      orderBy: { date: 'asc' },
      select: {
        date: true, workout_id: true, best_e1rm: true, top_set_weight: true,
        top_set_reps: true, total_volume: true, working_sets: true, total_sets: true,
        avg_rpe: true
      }
    }),
    prisma.personalRecord.findMany({
      where: { user_id: userId, exercise_name: exerciseName },
      select: { workout_id: true, type: true, value: true }
    })
  ])

  const recordsByWorkout = new Map<string, string[]>()
  for (const r of records) {
    if (!r.workout_id) continue
    const list = recordsByWorkout.get(r.workout_id) ?? []
    list.push(r.type)
    recordsByWorkout.set(r.workout_id, list)
  }

  return {
    exercise: exerciseName,
    points: rows.map(r => ({
      date: r.date.toISOString(),
      estimated_1rm: r.best_e1rm,
      max_weight: r.top_set_weight,
      top_set_reps: r.top_set_reps,
      total_volume: r.total_volume,
      sets: r.working_sets,
      total_sets: r.total_sets,
      avg_rpe: r.avg_rpe,
      records: recordsByWorkout.get(r.workout_id) ?? []
    }))
  }
})
