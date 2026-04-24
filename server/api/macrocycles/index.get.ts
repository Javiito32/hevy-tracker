import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  return prisma.macrocycle.findMany({
    where: { user_id: userId },
    orderBy: { start_date: 'desc' },
    include: {
      mesocycles: {
        orderBy: { start_date: 'asc' },
        select: { id: true, name: true, status: true, start_date: true, end_date: true, goal: true, _count: { select: { workouts: true } } }
      }
    }
  })
})
