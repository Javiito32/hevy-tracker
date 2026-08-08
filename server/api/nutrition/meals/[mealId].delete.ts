import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireDraftMeal, recalcVersionTotals } from '../../../utils/diet-service'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const mealId = getRouterParam(event, 'mealId')!

  const meal = await requireDraftMeal(userId, mealId)

  await prisma.dietMeal.delete({ where: { id: mealId } })
  await recalcVersionTotals(meal.diet_version_id)
  return { success: true }
})
