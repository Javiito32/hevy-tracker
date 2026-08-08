import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireOwnedPlan } from '../../../utils/diet-service'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')!
  const { name, goal, notes, status } = await readBody(event)

  await requireOwnedPlan(userId, id)

  if (status === 'active') {
    await prisma.dietPlan.updateMany({
      where: { user_id: userId, status: 'active', id: { not: id } },
      data: { status: 'archived' }
    })
  }

  return prisma.dietPlan.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(goal !== undefined && { goal: goal || null }),
      ...(notes !== undefined && { notes: notes || null }),
      ...(status !== undefined && { status })
    }
  })
})
