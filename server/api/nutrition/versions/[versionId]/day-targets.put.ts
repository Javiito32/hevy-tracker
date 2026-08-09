import { getSessionUser } from '../../../../utils/session'
import {
  requireOwnedVersion,
  assertDraft,
  saveDayTargets,
  loadVersionFull,
  serializeVersion,
  parseWeekday
} from '../../../../utils/diet-service'
import type { Weekday } from '../../../../utils/nutrition-calculator'

/** '' and null both clear a field; anything unparseable is a clear too, not a 0. */
const optionalNumber = (raw: any): number | null => {
  if (raw === undefined || raw === null || raw === '') return null
  const num = Number(raw)
  return Number.isFinite(num) && num >= 0 ? num : null
}

/**
 * Sets the per-weekday target override for one or more days.
 *
 * Sending all four macros empty deletes the override, so the day falls back to
 * the version's base target — there is no separate "clear" endpoint, because
 * "no override" and "an override of nothing" are the same state.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const versionId = getRouterParam(event, 'versionId')!
  const body = (await readBody(event)) || {}

  const version = await requireOwnedVersion(userId, versionId)
  assertDraft(version)

  const days: Weekday[] = Array.isArray(body.weekdays)
    ? ([...new Set(body.weekdays.map(parseWeekday))] as Weekday[])
    : [parseWeekday(body.weekday)]

  await saveDayTargets(versionId, days, {
    target_kcal: optionalNumber(body.target_kcal),
    target_protein_g: optionalNumber(body.target_protein_g),
    target_carbs_g: optionalNumber(body.target_carbs_g),
    target_fat_g: optionalNumber(body.target_fat_g)
  })

  // Targets don't enter the totals, but the response is the whole version so the
  // client re-renders from one source rather than patching its local copy.
  return serializeVersion(await loadVersionFull(versionId))
})
