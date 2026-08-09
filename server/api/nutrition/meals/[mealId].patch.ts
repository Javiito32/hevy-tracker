import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireDraftMeal, recalcVersionTotals, parseWeekday } from '../../../utils/diet-service'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const mealId = getRouterParam(event, 'mealId')!
  const { name, time_of_day, weekday, order_index } = await readBody(event)

  const meal = await requireDraftMeal(userId, mealId)

  // Moving a meal to another day has to re-seat it there: keeping its old
  // order_index would collide with whatever already occupies that position and
  // land it somewhere arbitrary in the target day.
  let move: { weekday: number; order_index: number } | null = null
  if (weekday !== undefined) {
    const day = parseWeekday(weekday)
    if (day !== meal.weekday) {
      const last = await prisma.dietMeal.findFirst({
        where: { diet_version_id: meal.diet_version_id, weekday: day },
        orderBy: { order_index: 'desc' },
        select: { order_index: true }
      })
      move = { weekday: day, order_index: (last?.order_index ?? -1) + 1 }
    }
  }

  const updated = await prisma.dietMeal.update({
    where: { id: mealId },
    data: {
      ...(name !== undefined && { name: String(name).trim() || meal.name }),
      ...(time_of_day !== undefined && { time_of_day: time_of_day || null }),
      ...(move ?? {}),
      // An explicit order_index still wins, for reordering within a day.
      ...(order_index !== undefined && { order_index: Number(order_index) })
    },
    include: { items: { orderBy: { order_index: 'asc' } } }
  })

  // A move changes two days' totals and the weekly average with them.
  await recalcVersionTotals(meal.diet_version_id)
  return updated
})
