import { getSessionUser } from '../../../../utils/session'
import {
  requireOwnedVersion,
  assertDraft,
  copyWeekday,
  recalcVersionTotals,
  loadVersionFull,
  serializeVersion,
  parseWeekday
} from '../../../../utils/diet-service'
import type { Weekday } from '../../../../utils/nutrition-calculator'

/**
 * Makes one or more weekdays an exact copy of another.
 *
 * Draft only, and a hard 409 otherwise: copying into a published version is
 * precisely the mutation the history's immutability forbids.
 *
 * There is no `mode: 'replace' | 'append'` parameter. Server surface with no UI
 * behind it is what `day_type` was — the thing this whole change exists to
 * undo — so append arrives the day something calls it.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const versionId = getRouterParam(event, 'versionId')!
  const body = (await readBody(event)) || {}

  const version = await requireOwnedVersion(userId, versionId)
  assertDraft(version)

  const from = parseWeekday(body.from_weekday)

  if (!Array.isArray(body.to_weekdays)) {
    throw createError({ statusCode: 400, statusMessage: 'Faltan los días de destino' })
  }

  // Dedupe, and drop the source: copying a day onto itself is a no-op the UI
  // shouldn't have to police.
  const to = [...new Set(body.to_weekdays.map(parseWeekday))].filter(d => d !== from) as Weekday[]
  if (to.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Elige al menos un día de destino distinto del origen' })
  }

  await copyWeekday(versionId, from, to)
  await recalcVersionTotals(versionId)

  return serializeVersion(await loadVersionFull(versionId))
})
