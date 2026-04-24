import { buildUserProfileAsync } from '../../utils/ai-context'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  return { preview: await buildUserProfileAsync(userId) }
})
