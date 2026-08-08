import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

/**
 * Workout list for the calendar and recent-activity views.
 *
 * Two things this endpoint deliberately does NOT do, both of which it used to:
 *
 * - It never selects `raw_data`. That column holds the verbatim Hevy payload
 *   for the session; shipping it for the whole history to draw one month of
 *   calendar cells was megabytes per request.
 * - It no longer returns everything unbounded. `?from`/`?to` scope the range,
 *   and without them it falls back to a recent window rather than the lot.
 */
const DEFAULT_DAYS = 120
const MAX_ROWS = 500

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const query = getQuery(event)

  const parse = (v: unknown): Date | null => {
    if (typeof v !== 'string' || !v) return null
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
  }

  const to = parse(query.to) ?? new Date()
  let from = parse(query.from)
  if (!from) {
    from = new Date(to)
    from.setDate(from.getDate() - DEFAULT_DAYS)
  }

  const workouts = await prisma.workout.findMany({
    where: { user_id: userId, date: { gte: from, lte: to } },
    orderBy: { start_time: 'desc' },
    take: MAX_ROWS,
    select: {
      id: true, hevy_id: true, name: true, description: true, date: true,
      start_time: true, end_time: true, duration: true, total_volume: true,
      total_tonnage: true, rpe_avg: true, notes: true, ai_analysis: true,
      mesocycle_id: true, exercises_summary: true
    }
  })

  return workouts.map(w => ({
    ...w,
    exercises_summary: w.exercises_summary ? JSON.parse(w.exercises_summary) : []
  }))
})
