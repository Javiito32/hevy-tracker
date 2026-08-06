import { prisma } from '../../../utils/prisma'
import { requireAdmin } from '../../../utils/session'

/**
 * Removes a model price. Routed by row id, not by model: slugs contain slashes
 * ('anthropic/claude-sonnet-5') which a single dynamic segment can't carry.
 *
 * Deleting a price doesn't touch usage history — those interactions simply stop
 * being costable and show as "—" again.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id del precio' })

  const existing = await prisma.aiModelPrice.findUnique({ where: { id }, select: { id: true } })
  if (!existing) throw createError({ statusCode: 404, statusMessage: 'Precio no encontrado' })

  await prisma.aiModelPrice.delete({ where: { id } })
  return { success: true }
})
