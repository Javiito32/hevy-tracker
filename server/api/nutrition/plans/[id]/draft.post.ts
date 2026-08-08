import { prisma } from '../../../../utils/prisma'
import { getSessionUser } from '../../../../utils/session'
import { ensureDraft, loadVersionFull, serializeVersion } from '../../../../utils/diet-service'

/**
 * Opens the plan for editing: returns the existing draft, or forks the active
 * version into a new one.
 *
 * Idempotent, so the UI can call it on every "Editar dieta" click without
 * accumulating drafts.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const planId = getRouterParam(event, 'id')!

  const draft = await ensureDraft(userId, planId)

  const [full, latestWeight] = await Promise.all([
    loadVersionFull(draft.id),
    prisma.bodyMetric.findFirst({
      where: { user_id: userId, weight: { not: null } },
      orderBy: { date: 'desc' },
      select: { weight: true }
    })
  ])

  return serializeVersion(full, { weightKg: latestWeight?.weight ?? null })
})
