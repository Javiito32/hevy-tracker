import { getSessionUser } from '../../../../utils/session'
import { publishDraft, loadVersionFull, serializeVersion } from '../../../../utils/diet-service'

const optionalNumber = (raw: any): number | null | undefined => {
  if (raw === undefined) return undefined
  if (raw === '' || raw === null) return null
  const num = Number(raw)
  return Number.isFinite(num) ? num : null
}

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const versionId = getRouterParam(event, 'versionId')!
  const body = (await readBody(event)) || {}

  const published = await publishDraft(userId, versionId, {
    change_note: body.change_note ?? null,
    targets: {
      target_kcal: optionalNumber(body.target_kcal),
      target_protein_g: optionalNumber(body.target_protein_g),
      target_carbs_g: optionalNumber(body.target_carbs_g),
      target_fat_g: optionalNumber(body.target_fat_g)
    } as Record<string, number | null>
  })

  return serializeVersion(await loadVersionFull(published.id))
})
