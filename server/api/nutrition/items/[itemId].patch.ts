import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireDraftItem, recalcVersionTotals } from '../../../utils/diet-service'
import { buildSnapshot } from '../../../utils/nutrition-calculator'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const itemId = getRouterParam(event, 'itemId')!
  const { quantity_g, order_index, refresh_snapshot } = await readBody(event)

  const item = await requireDraftItem(userId, itemId)
  const data: Record<string, any> = {}

  if (quantity_g !== undefined) {
    const grams = Number(quantity_g)
    if (!Number.isFinite(grams) || grams <= 0) {
      throw createError({ statusCode: 400, statusMessage: 'La cantidad debe ser mayor que 0 g' })
    }
    data.quantity_g = grams
  }

  if (order_index !== undefined) data.order_index = Number(order_index)

  // Opt-in re-read of the catalogue: the only way a corrected Food reaches an
  // existing item, and it is available on drafts alone.
  if (refresh_snapshot && item.food_id) {
    const food = await prisma.food.findFirst({ where: { id: item.food_id, user_id: userId } })
    if (!food) throw createError({ statusCode: 404, statusMessage: 'El alimento ya no está en tu catálogo' })
    data.food_name = food.name
    data.nutrients_snapshot = buildSnapshot(food)
  }

  const updated = await prisma.dietItem.update({ where: { id: itemId }, data })
  await recalcVersionTotals(item.diet_meal.diet_version_id)
  return updated
})
