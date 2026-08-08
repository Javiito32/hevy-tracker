import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')!

  const owned = await prisma.food.findFirst({ where: { id, user_id: userId }, select: { id: true } })
  if (!owned) throw createError({ statusCode: 404, statusMessage: 'Alimento no encontrado' })

  // Hard delete. DietItem.food_id is SetNull and every item keeps food_name plus
  // its nutrients_snapshot, so past diet versions still read correctly.
  await prisma.food.delete({ where: { id } })
  return { success: true }
})
