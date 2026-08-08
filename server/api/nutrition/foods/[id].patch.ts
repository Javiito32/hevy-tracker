import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildFoodData } from '../../../utils/food-input'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')!
  const body = await readBody(event)

  const owned = await prisma.food.findFirst({ where: { id, user_id: userId }, select: { id: true } })
  if (!owned) throw createError({ statusCode: 404, statusMessage: 'Alimento no encontrado' })

  const data = buildFoodData(body, { partial: true })

  // Editing a food deliberately does NOT touch published diet versions: each
  // DietItem carries its own nutrients_snapshot, so history stays as it was.
  try {
    return await prisma.food.update({ where: { id }, data: data as any })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Ya tienes un alimento con ese código de barras'
      })
    }
    throw err
  }
})
