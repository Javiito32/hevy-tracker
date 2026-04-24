import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)

  const metrics = await prisma.bodyMetric.findMany({
    where: { user_id: userId, weight: { not: null } },
    orderBy: { date: 'asc' },
    select: { date: true, weight: true }
  })

  return metrics.map(m => ({
    date: m.date.toISOString(),
    weight: m.weight!
  }))
})
