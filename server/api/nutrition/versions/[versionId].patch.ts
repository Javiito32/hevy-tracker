import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { requireOwnedVersion, assertDraft, loadVersionFull, serializeVersion } from '../../../utils/diet-service'

const optionalNumber = (raw: any): number | null => {
  if (raw === '' || raw == null) return null
  const num = Number(raw)
  return Number.isFinite(num) && num >= 0 ? num : null
}

/**
 * Sets the daily targets on a draft. Drafts only — a published version is
 * frozen, targets included, since "what was I aiming for back then" is part of
 * what the history has to answer.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const versionId = getRouterParam(event, 'versionId')!
  const body = (await readBody(event)) || {}

  const version = await requireOwnedVersion(userId, versionId)
  assertDraft(version)

  const data: Record<string, any> = {}
  for (const key of ['target_kcal', 'target_protein_g', 'target_carbs_g', 'target_fat_g']) {
    if (body[key] !== undefined) data[key] = optionalNumber(body[key])
  }
  if (body.change_note !== undefined) data.change_note = body.change_note?.trim() || null

  await prisma.dietVersion.update({ where: { id: versionId }, data })

  return serializeVersion(await loadVersionFull(versionId))
})
