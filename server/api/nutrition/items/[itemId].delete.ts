import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireDraftItem, recalcVersionTotals } from '../../../utils/diet-service'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const itemId = getRouterParam(event, 'itemId')!

  const item = await requireDraftItem(userId, itemId)

  await prisma.dietItem.delete({ where: { id: itemId } })
  await recalcVersionTotals(item.diet_meal.diet_version_id)
  return { success: true }
})
