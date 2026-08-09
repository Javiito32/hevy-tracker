import { prisma } from './prisma'
import { fetchHevyExerciseTemplates } from './hevy-client'
import { buildWorkoutMetrics, metricsFromStoredSummary } from './workout-metrics'
import { writeWorkoutExercises } from './exercise-store'
import { rebuildPersonalRecords } from './personal-records'
import { runDetectors } from './plateau-detector'
import { syncUserData } from './sync-user'

/**
 * Background jobs: the Hevy sync and the admin migrations.
 *
 * All of them share one row type because they share one problem — they take
 * longer than an HTTP request should, and the caller needs to watch them. A
 * two-year sync is ~50 API calls (pageSize is capped at 10 by Hevy, so this
 * cost cannot be paginated away) plus hundreds of writes.
 *
 * The offline migrations are deliberately re-runnable: they derive everything
 * from `raw_data`, which the sync never mutates, so running one twice produces
 * the same database. That is what makes them safe to try on real data.
 */

export type JobKind =
  | 'sync'
  | 'exercise_templates'
  | 'rebuild_exercises'
  | 'recalc_metrics'
  | 'recalc_records'
  | 'ai_generate_plan'

export const JOB_LABELS: Record<JobKind, string> = {
  sync: 'Sincronización con Hevy',
  exercise_templates: 'Catálogo de ejercicios',
  rebuild_exercises: 'Reconstruir estructura de entrenos',
  recalc_metrics: 'Recalcular métricas',
  recalc_records: 'Recalcular récords',
  ai_generate_plan: 'Generar mesociclo con IA'
}

/** Jobs that touch the network. The rest run entirely on stored data. */
export const ONLINE_JOBS: JobKind[] = ['sync', 'exercise_templates', 'ai_generate_plan']

interface JobContext {
  jobId: string
  progress: (message: string, current?: number, total?: number) => Promise<void>
}

/**
 * Starts a job and returns immediately with its id.
 *
 * The promise is deliberately not awaited: the endpoint answers as soon as the
 * row exists so the UI can start polling. Errors are captured onto the row
 * rather than escaping into an unhandled rejection.
 *
 * `reuseRunning` (default true) returns the job already in flight instead of
 * starting a second one. That is right for everything that writes to the
 * database — two syncs would race over the same rows — and wrong for a job
 * whose result depends on its arguments, where the caller asking for a 5-day
 * block would silently receive the 3-day one still running.
 */
export async function startJob(
  kind: JobKind,
  userId: string | null,
  run: (ctx: JobContext) => Promise<Record<string, unknown>>,
  options: { reuseRunning?: boolean } = {}
): Promise<string> {
  if (options.reuseRunning !== false) {
    const existing = await prisma.maintenanceJob.findFirst({
      where: { kind, user_id: userId, status: { in: ['pending', 'running'] } },
      select: { id: true }
    })
    if (existing) return existing.id
  }

  const job = await prisma.maintenanceJob.create({
    data: { kind, user_id: userId, status: 'running', started_at: new Date(), message: 'Iniciando…' }
  })

  const ctx: JobContext = {
    jobId: job.id,
    progress: async (message, current, total) => {
      await prisma.maintenanceJob.update({
        where: { id: job.id },
        data: {
          message,
          ...(current != null ? { progress_current: current } : {}),
          ...(total != null ? { progress_total: total } : {})
        }
      }).catch(() => { /* progress is advisory; never fail a job over it */ })
    }
  }

  void run(ctx)
    .then(async (result) => {
      await prisma.maintenanceJob.update({
        where: { id: job.id },
        data: {
          status: 'done',
          finished_at: new Date(),
          message: 'Completado',
          result_json: JSON.stringify(result)
        }
      })
    })
    .catch(async (err: any) => {
      console.error(`❌ Job ${kind} (${job.id}) falló:`, err)
      await prisma.maintenanceJob.update({
        where: { id: job.id },
        data: {
          status: 'error',
          finished_at: new Date(),
          error: String(err?.statusMessage ?? err?.message ?? err).slice(0, 1000)
        }
      }).catch(() => {})
    })

  return job.id
}

// ── Migration 1: exercise catalogue ─────────────────────────────────────────

/**
 * Pulls Hevy's exercise catalogue. Global, not per user: a non-custom template
 * is the same row for everyone, so it is keyed by Hevy's id and upserted.
 *
 * Needs *an* API key to read the catalogue; any active user's will do, since
 * the non-custom catalogue is identical for all of them. Custom exercises are
 * tagged with the key's owner.
 */
export async function runExerciseTemplateSync(ctx: JobContext, apiKeyOwnerId: string, apiKey: string) {
  let page = 1
  let pageCount = 1
  let imported = 0
  let custom = 0

  while (page <= pageCount) {
    const res = await fetchHevyExerciseTemplates(apiKey, page)
    pageCount = res.pageCount || 1
    if (!res.data.length) break

    for (const t of res.data) {
      if (!t?.id) continue
      const isCustom = Boolean(t.is_custom)
      if (isCustom) custom++

      await prisma.exerciseTemplate.upsert({
        where: { id: t.id },
        update: {
          title: t.title ?? 'Ejercicio',
          type: t.type ?? 'weight_reps',
          primary_muscle_group: t.primary_muscle_group ?? 'other',
          secondary_muscle_groups: JSON.stringify(t.secondary_muscle_groups ?? []),
          equipment_category: t.equipment_category ?? null,
          is_custom: isCustom,
          // Only custom templates belong to a user; overwriting this on a global
          // one would hide it from everyone else.
          ...(isCustom ? { user_id: apiKeyOwnerId } : {}),
          synced_at: new Date()
        },
        create: {
          id: t.id,
          title: t.title ?? 'Ejercicio',
          type: t.type ?? 'weight_reps',
          primary_muscle_group: t.primary_muscle_group ?? 'other',
          secondary_muscle_groups: JSON.stringify(t.secondary_muscle_groups ?? []),
          equipment_category: t.equipment_category ?? null,
          is_custom: isCustom,
          user_id: isCustom ? apiKeyOwnerId : null
        }
      })
      imported++
    }

    await ctx.progress(`Importando plantillas (página ${page}/${pageCount})`, page, pageCount)
    page++
  }

  return { imported, custom, pages: pageCount }
}

// ── Migration 2: rebuild normalised exercises ───────────────────────────────

/**
 * Rebuilds WorkoutExercise/ExerciseSet from stored `raw_data`.
 *
 * Entirely offline: Hevy puts `exercise_template_id` inside every workout
 * payload, and that payload is stored verbatim, so the whole history can be
 * classified without a single API call.
 */
export async function runRebuildExercises(ctx: JobContext, userId: string) {
  const workouts = await prisma.workout.findMany({
    where: { user_id: userId },
    orderBy: { date: 'asc' },
    select: { id: true, date: true, raw_data: true, exercises_summary: true }
  })

  let rebuilt = 0
  let fromSummary = 0
  let skipped = 0

  for (let i = 0; i < workouts.length; i++) {
    const w = workouts[i]
    let metrics = null

    if (w.raw_data) {
      try {
        metrics = buildWorkoutMetrics(JSON.parse(w.raw_data))
      } catch { /* falls through to the summary path below */ }
    }
    // A row whose raw_data is missing or corrupt still has its stored summary.
    // Lossy, but better than leaving the workout invisible to every analysis.
    if (!metrics) {
      metrics = metricsFromStoredSummary(w.exercises_summary)
      if (metrics) fromSummary++
    }

    if (!metrics) { skipped++; continue }

    await writeWorkoutExercises(w.id, userId, w.date, metrics.summary)
    rebuilt++

    if (i % 20 === 0 || i === workouts.length - 1) {
      await ctx.progress(`Reconstruyendo entrenos`, i + 1, workouts.length)
    }
  }

  const unlinked = await prisma.workoutExercise.count({
    where: { user_id: userId, exercise_template_id: null }
  })

  return { rebuilt, from_summary: fromSummary, skipped, unlinked_exercises: unlinked }
}

// ── Migration 3: recalculate metrics ────────────────────────────────────────

/**
 * Rewrites volume, tonnage, RPE and e1RM with the corrected rules — warm-ups
 * excluded, Epley capped, RPE-corrected 1RM.
 *
 * Shares `buildWorkoutMetrics` with the sync, so the numbers it writes are the
 * numbers the next sync would write.
 */
export async function runRecalcMetrics(ctx: JobContext, userId: string) {
  const workouts = await prisma.workout.findMany({
    where: { user_id: userId },
    orderBy: { date: 'asc' },
    select: { id: true, raw_data: true, exercises_summary: true, total_volume: true }
  })

  let updated = 0
  let skipped = 0
  let volumeDelta = 0

  for (let i = 0; i < workouts.length; i++) {
    const w = workouts[i]
    let metrics = null

    if (w.raw_data) {
      try {
        metrics = buildWorkoutMetrics(JSON.parse(w.raw_data))
      } catch { /* handled below */ }
    }
    if (!metrics) metrics = metricsFromStoredSummary(w.exercises_summary)
    if (!metrics) { skipped++; continue }

    volumeDelta += metrics.totalVolume - (w.total_volume ?? 0)

    await prisma.workout.update({
      where: { id: w.id },
      data: {
        total_volume: metrics.totalVolume,
        total_tonnage: metrics.totalTonnage,
        rpe_avg: metrics.rpeAvg,
        exercises_summary: JSON.stringify(metrics.summary)
      }
    })
    updated++

    if (i % 20 === 0 || i === workouts.length - 1) {
      await ctx.progress('Recalculando métricas', i + 1, workouts.length)
    }
  }

  return {
    updated,
    skipped,
    // Almost always negative: it is the warm-up tonnage that used to be counted
    // as work. Reporting it makes the correction auditable rather than silent.
    volume_delta_kg: Math.round(volumeDelta)
  }
}

// ── Migration 4: rebuild records ────────────────────────────────────────────

export async function runRecalcRecords(ctx: JobContext, userId: string) {
  const created = await rebuildPersonalRecords(userId, async (done, total) => {
    await ctx.progress('Recalculando récords', done, total)
  })
  return { records: created }
}

// ── The sync itself ─────────────────────────────────────────────────────────

export async function runSync(ctx: JobContext, userId: string, apiKey: string) {
  return await syncUserData(userId, apiKey, async (step, current, total) => {
    await ctx.progress(step, current, total)
  })
}

/** Re-runs the detectors for one user without a full sync. */
export async function runDetectorsOnly(userId: string) {
  return await runDetectors(userId)
}
