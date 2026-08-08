import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireDraftMeal, recalcVersionTotals } from '../../../utils/diet-service'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const mealId = getRouterParam(event, 'mealId')!
  const { name, time_of_day, day_type, order_index } = await readBody(event)

  const meal = await requireDraftMeal(userId, mealId)

  const updated = await prisma.dietMeal.update({
    where: { id: mealId },
    data: {
      ...(name !== undefined && { name: String(name).trim() || meal.name }),
      ...(time_of_day !== undefined && { time_of_day: time_of_day || null }),
      ...(day_type !== undefined &&
        ['all', 'training', 'rest'].includes(day_type) && { day_type }),
      ...(order_index !== undefined && { order_index: Number(order_index) })
    },
    include: { items: { orderBy: { order_index: 'asc' } } }
  })

  // day_type moves a meal between the training/rest buckets, so totals change.
  await recalcVersionTotals(meal.diet_version_id)
  return updated
})
