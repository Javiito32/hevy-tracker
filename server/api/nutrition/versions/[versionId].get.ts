import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireOwnedVersion, loadVersionFull, serializeVersion } from '../../../utils/diet-service'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const versionId = getRouterParam(event, 'versionId')!

  const owned = await requireOwnedVersion(userId, versionId)

  const [full, latestWeight] = await Promise.all([
    loadVersionFull(versionId),
    prisma.bodyMetric.findFirst({
      where: { user_id: userId, weight: { not: null } },
      orderBy: { date: 'desc' },
      select: { weight: true }
    })
  ])

  return {
    plan: owned.diet_plan,
    version: serializeVersion(full, { weightKg: latestWeight?.weight ?? null })
  }
})
