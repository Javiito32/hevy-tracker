import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireOwnedVersion, assertDraft, recalcVersionTotals, parseWeekday } from '../../../utils/diet-service'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const body = await readBody(event)
  const { diet_version_id, name, time_of_day, weekday } = body

  if (!diet_version_id) throw createError({ statusCode: 400, statusMessage: 'Falta la versión de la dieta' })
  if (!name?.trim()) throw createError({ statusCode: 400, statusMessage: 'El nombre de la comida es obligatorio' })

  // Required, and a 400 when absent or out of range. A meal has to belong to a
  // day, and guessing one would put it where the user isn't looking.
  const day = parseWeekday(weekday)

  const version = await requireOwnedVersion(userId, diet_version_id)
  assertDraft(version)

  // Scoped to the weekday: order_index is a position within its own day, so a
  // version-wide max would give Tuesday's first meal an index of 12.
  const last = await prisma.dietMeal.findFirst({
    where: { diet_version_id, weekday: day },
    orderBy: { order_index: 'desc' },
    select: { order_index: true }
  })

  const meal = await prisma.dietMeal.create({
    data: {
      diet_version_id,
      name: name.trim(),
      weekday: day,
      time_of_day: time_of_day || null,
      order_index: (last?.order_index ?? -1) + 1
    },
    include: { items: true }
  })

  // An empty meal changes no totals, but recalcing unconditionally keeps every
  // write path identical — that uniformity is what stops totals from drifting.
  await recalcVersionTotals(diet_version_id)
  return meal
})
