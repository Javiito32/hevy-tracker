import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const exerciseName = decodeURIComponent(getRouterParam(event, 'exercise') ?? '')
  if (!exerciseName) throw createError({ statusCode: 400, statusMessage: 'Exercise name required' })

  const workouts = await prisma.workout.findMany({
    where: { user_id: userId },
    orderBy: { date: 'asc' },
    select: { date: true, exercises_summary: true }
  })

  const points: {
    date: string
    estimated_1rm: number | null
    max_weight: number | null
    total_volume: number
    sets: number
  }[] = []

  for (const w of workouts) {
    const exercises: any[] = w.exercises_summary ? JSON.parse(w.exercises_summary) : []
    const ex = exercises.find((e: any) => e.name === exerciseName)
    if (!ex) continue

    const maxWeight = (ex.sets_details || []).reduce((max: number, s: any) => {
      const kg = parseFloat(s.weight)
      return !isNaN(kg) && kg > max ? kg : max
    }, 0)

    points.push({
      date: w.date.toISOString(),
      estimated_1rm: ex.estimated_1rm ? parseFloat(ex.estimated_1rm) : null,
      max_weight: maxWeight > 0 ? maxWeight : null,
      total_volume: ex.total_volume ?? 0,
      sets: ex.sets ?? 0
    })
  }

  return { exercise: exerciseName, points }
})
