import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Workout ID is required' })

  const body = await readBody(event)

  const workout = await prisma.workout.findFirst({ where: { id, user_id: userId } })
  if (!workout) throw createError({ statusCode: 404, statusMessage: 'Workout not found' })

  const updated = await prisma.workout.update({
    where: { id },
    data: { notes: body.notes ?? null }
  })

  return { success: true, notes: updated.notes }
})
