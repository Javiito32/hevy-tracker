import { getSessionUser } from '../../../utils/session'
import { savePlan, loadPlan, type PlannedSessionInput, type WeekInput } from '../../../utils/plan-service'

/**
 * Replaces the mesocycle's structured plan.
 *
 * Goes through savePlan() rather than writing rows here, so
 * `split_description` and `target_sessions_weekly` stay derived from the
 * structure instead of drifting away from it.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const mesocycleId = getRouterParam(event, 'id') as string

  const body = await readBody<{ sessions?: PlannedSessionInput[]; weeks?: WeekInput[] }>(event)
  const sessions = body?.sessions

  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw createError({ statusCode: 400, message: 'El plan necesita al menos una sesión.' })
  }
  for (const s of sessions) {
    if (!s?.name?.trim()) throw createError({ statusCode: 400, message: 'Cada sesión necesita un nombre.' })
    if (!Array.isArray(s.exercises) || s.exercises.length === 0) {
      throw createError({ statusCode: 400, message: `La sesión "${s.name}" no tiene ejercicios.` })
    }
  }

  const result = await savePlan(mesocycleId, userId, sessions, body?.weeks ?? [])
  const plan = await loadPlan(mesocycleId, userId)

  return {
    success: true,
    ...result,
    plan,
    ...(result.unmatched.length && {
      warning: `Sin correspondencia en el catálogo: ${result.unmatched.join(', ')}. Se guardaron por nombre, pero no se enviarán a Hevy.`
    })
  }
})
