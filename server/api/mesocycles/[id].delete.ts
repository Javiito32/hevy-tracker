import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

/**
 * Deletes a mesocycle.
 *
 * What survives matters more than what goes. The plan (weeks, sessions,
 * exercises), the weekly evaluations and the diary notes all cascade — each is
 * a reading of this block and means nothing without it. The **workouts do
 * not**: `Workout.mesocycle_id` is SetNull, so every session logged during the
 * block stays in the history, along with its volume, records and alerts. The
 * block was the plan they were attributed to, not the record that they happened.
 *
 * Routines already pushed to Hevy are left alone. They live in the athlete's
 * own account, and silently reaching into an external app to delete things is
 * not something a "delete this block" button should do; the response reports
 * how many were pushed so the UI can say so.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')!

  // 404 on someone else's id, never 403 — the same rule
  // requireOwnedConversation() follows: a 403 confirms the id exists.
  const owned = await prisma.mesocycle.findFirst({
    where: { id, user_id: userId },
    select: {
      id: true,
      name: true,
      hevy_folder_id: true,
      _count: { select: { workouts: true } },
      planned_sessions: { select: { hevy_routine_id: true } }
    }
  })
  if (!owned) throw createError({ statusCode: 404, message: 'Mesociclo no encontrado' })

  const pushedRoutines = owned.planned_sessions.filter(s => s.hevy_routine_id).length

  await prisma.mesocycle.delete({ where: { id } })

  return {
    success: true,
    name: owned.name,
    /** Kept, not deleted — surfaced so the UI can say so out loud. */
    workouts_kept: owned._count.workouts,
    /** Still in the athlete's Hevy account; this endpoint does not touch them. */
    hevy_routines_left: pushedRoutines,
    hevy_folder_left: owned.hevy_folder_id != null
  }
})
