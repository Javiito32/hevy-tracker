import { getSessionUser } from '../../../../utils/session'
import { discardDraft } from '../../../../utils/diet-service'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const versionId = getRouterParam(event, 'versionId')!

  // Only a draft can be discarded; assertDraft inside discardDraft 409s on a
  // published version, so history can never be deleted through this route.
  return discardDraft(userId, versionId)
})
