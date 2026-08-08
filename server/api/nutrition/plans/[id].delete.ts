import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireOwnedPlan } from '../../../utils/diet-service'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')!

  await requireOwnedPlan(userId, id)

  // Cascades through versions, meals and items — the entire history of this
  // plan goes with it, which is why the UI asks for confirmation.
  await prisma.dietPlan.delete({ where: { id } })
  return { success: true }
})
