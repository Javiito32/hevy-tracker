import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

/**
 * Dismisses or restores an alert.
 *
 * Dismissal is a user judgement the detector must respect: it re-runs after
 * every sync, and without this it would resurrect the same alert forever until
 * the athlete stopped reading any of them.
 *
 * 404s on someone else's alert rather than 403, the same way
 * requireOwnedConversation does — an id the user doesn't own shouldn't be
 * confirmed as existing.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ status?: string }>(event)

  const status = body?.status
  if (status !== 'dismissed' && status !== 'active') {
    throw createError({ statusCode: 400, message: 'status debe ser "dismissed" o "active"' })
  }

  const alert = await prisma.trainingAlert.findFirst({ where: { id, user_id: userId } })
  if (!alert) throw createError({ statusCode: 404, message: 'Alerta no encontrada' })

  const updated = await prisma.trainingAlert.update({
    where: { id: alert.id },
    data: {
      status,
      dismissed_at: status === 'dismissed' ? new Date() : null
    }
  })

  return { success: true, status: updated.status }
})
