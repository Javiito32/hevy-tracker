import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')!

  const mesocycle = await prisma.mesocycle.findFirst({
    where: { id, user_id: userId },
    include: {
      workouts: {
        orderBy: { date: 'desc' },
        select: { id: true, name: true, date: true, total_volume: true, rpe_avg: true, duration: true, exercises_summary: true }
      },
      _count: { select: { workouts: true } }
    }
  })

  if (!mesocycle) throw createError({ statusCode: 404, statusMessage: 'Mesocycle not found' })
  return mesocycle
})
