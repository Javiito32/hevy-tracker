import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireDraftMeal, recalcVersionTotals } from '../../../utils/diet-service'
import { buildSnapshot } from '../../../utils/nutrition-calculator'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const { diet_meal_id, food_id, quantity_g } = await readBody(event)

  if (!diet_meal_id) throw createError({ statusCode: 400, statusMessage: 'Falta la comida' })
  if (!food_id) throw createError({ statusCode: 400, statusMessage: 'Falta el alimento' })

  const grams = Number(quantity_g)
  if (!Number.isFinite(grams) || grams <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'La cantidad debe ser mayor que 0 g' })
  }

  const meal = await requireDraftMeal(userId, diet_meal_id)

  const food = await prisma.food.findFirst({ where: { id: food_id, user_id: userId } })
  if (!food) throw createError({ statusCode: 404, statusMessage: 'Alimento no encontrado' })

  const last = await prisma.dietItem.findFirst({
    where: { diet_meal_id },
    orderBy: { order_index: 'desc' },
    select: { order_index: true }
  })

  const item = await prisma.dietItem.create({
    data: {
      diet_meal_id,
      food_id: food.id,
      // Name and nutrients are captured HERE, at insert time. Everything the
      // history feature promises rests on this line: editing or deleting the
      // catalogue entry later cannot reach back and change what this plan said.
      food_name: food.name,
      nutrients_snapshot: buildSnapshot(food),
      quantity_g: grams,
      order_index: (last?.order_index ?? -1) + 1
    }
  })

  await recalcVersionTotals(meal.diet_version_id)
  return item
})
