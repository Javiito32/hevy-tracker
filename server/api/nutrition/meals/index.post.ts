import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireOwnedVersion, assertDraft, recalcVersionTotals } from '../../../utils/diet-service'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const body = await readBody(event)
  const { diet_version_id, name, time_of_day, day_type } = body

  if (!diet_version_id) throw createError({ statusCode: 400, statusMessage: 'Falta la versión de la dieta' })
  if (!name?.trim()) throw createError({ statusCode: 400, statusMessage: 'El nombre de la comida es obligatorio' })

  const version = await requireOwnedVersion(userId, diet_version_id)
  assertDraft(version)

  const last = await prisma.dietMeal.findFirst({
    where: { diet_version_id },
    orderBy: { order_index: 'desc' },
    select: { order_index: true }
  })

  const meal = await prisma.dietMeal.create({
    data: {
      diet_version_id,
      name: name.trim(),
      time_of_day: time_of_day || null,
      day_type: ['all', 'training', 'rest'].includes(day_type) ? day_type : 'all',
      order_index: (last?.order_index ?? -1) + 1
    },
    include: { items: true }
  })

  // An empty meal changes no totals, but recalcing unconditionally keeps every
  // write path identical — that uniformity is what stops totals from drifting.
  await recalcVersionTotals(diet_version_id)
  return meal
})
