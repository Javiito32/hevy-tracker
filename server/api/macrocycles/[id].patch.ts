import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')!
  const { name, goal, start_date, end_date, notes } = await readBody(event)

  return prisma.macrocycle.updateMany({
    where: { id, user_id: userId },
    data: {
      ...(name !== undefined && { name }),
      ...(goal !== undefined && { goal: goal || null }),
      ...(start_date !== undefined && { start_date: new Date(start_date) }),
      ...(end_date !== undefined && { end_date: end_date ? new Date(end_date) : null }),
      ...(notes !== undefined && { notes: notes || null })
    }
  })
})
