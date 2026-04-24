import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)

  const workouts = await prisma.workout.findMany({
    where: { user_id: userId },
    orderBy: { start_time: 'desc' }
  })

  return workouts.map(w => ({
    ...w,
    exercises_summary: w.exercises_summary ? JSON.parse(w.exercises_summary) : []
  }))
})
