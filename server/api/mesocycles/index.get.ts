import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id } = await getSessionUser(event)
  return prisma.mesocycle.findMany({
    where: { user_id: id },
    orderBy: { start_date: 'desc' },
    include: { _count: { select: { workouts: true } } }
  })
})
