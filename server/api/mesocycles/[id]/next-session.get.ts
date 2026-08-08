import { getSessionUser } from '../../../utils/session'
import { getNextSession } from '../../../utils/plan-service'

/**
 * What to train next, with a suggested load per exercise.
 *
 * The screen the athlete opens in the gym — everything else in the app looks
 * backwards at what already happened.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const mesocycleId = getRouterParam(event, 'id') as string
  return await getNextSession(userId, mesocycleId)
})
