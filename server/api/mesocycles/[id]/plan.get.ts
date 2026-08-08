import { getSessionUser } from '../../../utils/session'
import { loadPlan, getAdherence } from '../../../utils/plan-service'

/** The structured plan plus planned-vs-performed adherence. */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const mesocycleId = getRouterParam(event, 'id') as string

  const [plan, adherence] = await Promise.all([
    loadPlan(mesocycleId, userId),
    getAdherence(userId, mesocycleId)
  ])

  return { ...plan, adherence }
})
