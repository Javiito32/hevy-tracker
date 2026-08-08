import { prisma } from '../../utils/prisma'
import { requireAdmin } from '../../utils/session'
import { findUnclassifiedExercises } from '../../utils/exercise-store'
import { MUSCLE_GROUPS, MUSCLE_LABELS } from '../../utils/muscle-groups'

/**
 * Exercises whose muscle group can't be resolved — a custom exercise deleted in
 * Hevy, or one logged before the catalogue knew it.
 *
 * Their sets land in no muscle bucket, so an unattended backlog here quietly
 * understates every weekly volume figure. The endpoint returns the catalogue
 * vocabulary alongside so the admin form has its options without a second call.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const userId = getQuery(event).userId as string | undefined
  const users = userId
    ? await prisma.user.findMany({ where: { id: userId }, select: { id: true, name: true } })
    : await prisma.user.findMany({ where: { is_active: true }, select: { id: true, name: true } })

  const perUser = await Promise.all(
    users.map(async (u) => ({
      user_id: u.id,
      user_name: u.name,
      exercises: await findUnclassifiedExercises(u.id)
    }))
  )

  return {
    users: perUser.filter(u => u.exercises.length > 0),
    muscle_groups: MUSCLE_GROUPS.map(g => ({ value: g, label: MUSCLE_LABELS[g] ?? g })),
    total: perUser.reduce((sum, u) => sum + u.exercises.filter(e => !e.has_override).length, 0)
  }
})
