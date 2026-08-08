import { prisma } from '../../utils/prisma'
import { requireAdmin } from '../../utils/session'
import { MUSCLE_GROUPS } from '../../utils/muscle-groups'

/**
 * Assigns a muscle group to an exercise the catalogue couldn't resolve.
 *
 * Keyed by exercise NAME, not template id: these rows have no usable template
 * id left, which is the entire reason the override table exists. Upsert so
 * correcting a previous assignment is the same operation as making one.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const body = await readBody<{
    userId?: string
    exerciseName?: string
    primary?: string
    secondary?: string[]
  }>(event)

  const userId = body?.userId?.trim()
  const exerciseName = body?.exerciseName?.trim()
  const primary = body?.primary?.trim()

  if (!userId || !exerciseName || !primary) {
    throw createError({ statusCode: 400, message: 'userId, exerciseName y primary son obligatorios' })
  }
  if (!MUSCLE_GROUPS.includes(primary as any)) {
    throw createError({ statusCode: 400, message: `Grupo muscular desconocido: ${primary}` })
  }

  const secondary = (body?.secondary ?? [])
    .filter(m => MUSCLE_GROUPS.includes(m as any) && m !== primary)

  const override = await prisma.exerciseMuscleOverride.upsert({
    where: { user_id_exercise_name: { user_id: userId, exercise_name: exerciseName } },
    update: { primary_muscle_group: primary, secondary_muscle_groups: JSON.stringify(secondary) },
    create: {
      user_id: userId,
      exercise_name: exerciseName,
      primary_muscle_group: primary,
      secondary_muscle_groups: JSON.stringify(secondary)
    }
  })

  return { success: true, override }
})
