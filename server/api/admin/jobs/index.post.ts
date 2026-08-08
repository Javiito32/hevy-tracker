import { prisma } from '../../../utils/prisma'
import { requireAdmin } from '../../../utils/session'
import {
  startJob, runExerciseTemplateSync, runRebuildExercises,
  runRecalcMetrics, runRecalcRecords, runSync, type JobKind
} from '../../../utils/maintenance'

const KINDS: JobKind[] = ['sync', 'exercise_templates', 'rebuild_exercises', 'recalc_metrics', 'recalc_records']

/**
 * Launches a maintenance job and returns its id immediately.
 *
 * `user_id` scoping differs per kind and is not a caller choice: the exercise
 * catalogue is global (one row per Hevy template, shared by everyone), while
 * the three offline rebuilds operate on one user's history at a time.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const body = await readBody<{ kind?: string; userId?: string; allUsers?: boolean }>(event)
  const kind = body?.kind as JobKind

  if (!kind || !KINDS.includes(kind)) {
    throw createError({ statusCode: 400, message: `kind debe ser uno de: ${KINDS.join(', ')}` })
  }

  // ── Global: the exercise catalogue ────────────────────────────────────────
  if (kind === 'exercise_templates') {
    // Reading the catalogue needs any valid key; the non-custom templates it
    // returns are identical whichever account asks.
    const owner = await prisma.user.findFirst({
      where: { is_active: true, hevy_api_key: { not: null } },
      select: { id: true, hevy_api_key: true }
    })
    if (!owner?.hevy_api_key) {
      throw createError({
        statusCode: 400,
        message: 'Ningún usuario tiene una API key de Hevy configurada; sin ella no se puede leer el catálogo.'
      })
    }
    const jobId = await startJob('exercise_templates', null, (ctx) =>
      runExerciseTemplateSync(ctx, owner.id, owner.hevy_api_key as string)
    )
    return { jobId }
  }

  // ── Per user ──────────────────────────────────────────────────────────────
  const targets = body?.allUsers
    ? await prisma.user.findMany({ where: { is_active: true }, select: { id: true, hevy_api_key: true } })
    : await prisma.user.findMany({ where: { id: body?.userId ?? '' }, select: { id: true, hevy_api_key: true } })

  if (targets.length === 0) {
    throw createError({ statusCode: 400, message: 'Indica un userId válido o allUsers: true' })
  }

  const jobIds: string[] = []
  for (const target of targets) {
    if (kind === 'sync') {
      if (!target.hevy_api_key) continue
      jobIds.push(await startJob('sync', target.id, (ctx) => runSync(ctx, target.id, target.hevy_api_key as string)))
    } else if (kind === 'rebuild_exercises') {
      jobIds.push(await startJob(kind, target.id, (ctx) => runRebuildExercises(ctx, target.id)))
    } else if (kind === 'recalc_metrics') {
      jobIds.push(await startJob(kind, target.id, (ctx) => runRecalcMetrics(ctx, target.id)))
    } else if (kind === 'recalc_records') {
      jobIds.push(await startJob(kind, target.id, (ctx) => runRecalcRecords(ctx, target.id)))
    }
  }

  if (jobIds.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'No se lanzó ningún trabajo. Para sincronizar, el usuario necesita una API key de Hevy.'
    })
  }

  return { jobId: jobIds[0], jobIds, launched: jobIds.length }
})
