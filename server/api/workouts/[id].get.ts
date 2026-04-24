import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'Workout ID is required' })

  const workout = await prisma.workout.findFirst({ where: { id, user_id: userId } })

  if (!workout) throw createError({ statusCode: 404, statusMessage: 'Workout not found' })

  return {
    ...workout,
    exercises_summary: workout.exercises_summary ? JSON.parse(workout.exercises_summary) : []
  }
})
