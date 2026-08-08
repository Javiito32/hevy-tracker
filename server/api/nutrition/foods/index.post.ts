import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildFoodData } from '../../../utils/food-input'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const body = await readBody(event)

  const data = buildFoodData(body)

  try {
    return await prisma.food.create({
      data: { ...data, user_id: userId, source: 'manual' } as any
    })
  } catch (err: any) {
    // @@unique([user_id, barcode]) — the catalogue already has this code.
    if (err?.code === 'P2002') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Ya tienes un alimento con ese código de barras'
      })
    }
    throw err
  }
})
