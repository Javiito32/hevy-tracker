import { getSessionUser } from '../../../../utils/session'
import { publishDraft, loadVersionFull, serializeVersion } from '../../../../utils/diet-service'

/** Blank means "keep what the draft already has", not "clear the target". */
const optionalNumber = (raw: any): number | undefined => {
  if (raw === undefined || raw === '' || raw === null) return undefined
  const num = Number(raw)
  return Number.isFinite(num) ? num : undefined
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
    }
  })

  return serializeVersion(await loadVersionFull(published.id))
})
