import { prisma } from './prisma'
import { fetchHevyWorkouts, fetchHevyWorkoutEvents, fetchHevyBodyMeasurements } from './hevy-client'
import { buildWorkoutMetrics } from './workout-metrics'
import { writeWorkoutExercises } from './exercise-store'
import { detectPersonalRecords } from './personal-records'
import { runDetectors } from './plateau-detector'


async function processAndSaveBodyMetric(userId: string, data: any) {
  if (!data || !data.date) return false
  const dateStr = data.date
  const weight = data.weight_kg ?? null
  const lean_mass = data.lean_mass_kg ?? null
  const fat = data.fat_percent ?? null
  const neck = data.neck_cm ?? null
  const shoulder = data.shoulder_cm ?? null
  const chest = data.chest_cm ?? null
  const left_bicep = data.left_bicep_cm ?? null
  const right_bicep = data.right_bicep_cm ?? null
  const left_forearm = data.left_forearm_cm ?? null
  const right_forearm = data.right_forearm_cm ?? null
  const abdomen = data.abdomen ?? null
  const waist = data.waist ?? null
  const hips = data.hips ?? null
  const left_thigh = data.left_thigh ?? null
  const right_thigh = data.right_thigh ?? null
  const left_calf = data.left_calf ?? null
  const right_calf = data.right_calf ?? null

  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`)
  const endOfDay = new Date(`${dateStr}T23:59:59.999Z`)

  const existing = await prisma.bodyMetric.findFirst({
    where: { user_id: userId, date: { gte: startOfDay, lt: endOfDay } }
  })

  if (existing) {
    await prisma.bodyMetric.update({
      where: { id: existing.id },
      data: { weight, lean_mass, body_fat_percentage: fat, neck, shoulder, chest, left_bicep, right_bicep, left_forearm, right_forearm, abdomen, waist, hips, left_thigh, right_thigh, left_calf, right_calf, raw_data: JSON.stringify(data) }
    })
  } else {
    await prisma.bodyMetric.create({
      data: {
        user_id: userId,
        date: new Date(`${dateStr}T12:00:00.000Z`),
        weight, lean_mass, body_fat_percentage: fat, neck, shoulder, chest, left_bicep, right_bicep, left_forearm, right_forearm, abdomen, waist, hips, left_thigh, right_thigh, left_calf, right_calf,
        raw_data: JSON.stringify(data)
      }
    })
  }
  return true
}

/** Returns the stored workout's id, or null when the payload was unusable. */
async function processAndSaveWorkout(
  userId: string,
  w: any,
  activeMesocycle?: { id: string; start_date: Date; end_date: Date | null } | null
): Promise<string | null> {
  if (!w || !w.id) return null

  const startTime = new Date(w.start_time)
  const date = startTime
  const endTime = new Date(w.end_time)
  const duration = Math.floor((endTime.getTime() - startTime.getTime()) / 1000)

  // All arithmetic lives in workout-metrics.ts so the admin recalculation job
  // produces byte-identical numbers to this sync.
  const metrics = buildWorkoutMetrics(w)

  let mesocycleId: string | null = null
  if (activeMesocycle) {
    const afterStart = startTime >= new Date(activeMesocycle.start_date)
    const beforeEnd = !activeMesocycle.end_date || startTime <= new Date(activeMesocycle.end_date)
    if (afterStart && beforeEnd) mesocycleId = activeMesocycle.id
  }

  const workout = await prisma.workout.upsert({
    where: { user_id_hevy_id: { user_id: userId, hevy_id: w.id } },
    update: {
      name: w.title,
      description: w.description || null,
      total_volume: metrics.totalVolume,
      total_tonnage: metrics.totalTonnage,
      rpe_avg: metrics.rpeAvg,
      duration,
      exercises_summary: JSON.stringify(metrics.summary),
      raw_data: JSON.stringify(w),
      updated_at: new Date(),
      ...(mesocycleId ? { mesocycle_id: mesocycleId } : {})
    },
    create: {
      user_id: userId,
      hevy_id: w.id,
      name: w.title,
      description: w.description || null,
      date,
      start_time: startTime,
      end_time: endTime,
      duration,
      total_volume: metrics.totalVolume,
      total_tonnage: metrics.totalTonnage,
      rpe_avg: metrics.rpeAvg,
      exercises_summary: JSON.stringify(metrics.summary),
      raw_data: JSON.stringify(w),
      mesocycle_id: mesocycleId
    }
  })

  await writeWorkoutExercises(workout.id, userId, date, metrics.summary)
  return workout.id
}

export interface SyncProgress {
  (step: string, current?: number, total?: number): Promise<void> | void
}

export async function syncUserData(
  userId: string,
  hevyApiKey: string,
  onProgress?: SyncProgress
): Promise<{ syncedWorkouts: number; syncedMetrics: number; newRecords: number; alerts: number }> {
  /** Workouts written this run — the only ones worth re-checking for records. */
  const touchedWorkouts: string[] = []
  // ── Workouts ──────────────────────────────────────────────────────────────
  await onProgress?.('Leyendo entrenamientos de Hevy')

  const activeMesocycle = await prisma.mesocycle.findFirst({
    where: { user_id: userId, status: 'active' },
    select: { id: true, start_date: true, end_date: true }
  })

  const existingCount = await prisma.workout.count({ where: { user_id: userId } })
  const useFullBootstrap = existingCount === 0
  let syncedWorkouts = 0

  console.log(`🔄 [user:${userId}] Sync workouts — ${useFullBootstrap ? 'Bootstrap' : 'Incremental'}`)

  if (useFullBootstrap) {
    let page = 1
    while (true) {
      const response = await fetchHevyWorkouts(hevyApiKey, page)
      if (!response || !response.data || response.data.length === 0) break
      for (const w of response.data) {
        const id = await processAndSaveWorkout(userId, w, activeMesocycle)
        if (id) { touchedWorkouts.push(id); syncedWorkouts++ }
      }
      await onProgress?.(`Importando historial completo`, page, response.pageCount)
      if (response.data.length < 10 || page >= response.pageCount) break
      page++
    }
  } else {
    const lastWorkout = await prisma.workout.findFirst({ where: { user_id: userId }, orderBy: { updated_at: 'desc' } })
    let page = 1
    while (true) {
      const response = await fetchHevyWorkoutEvents(hevyApiKey, page, page === 1 ? (lastWorkout?.updated_at || undefined) : undefined)
      if (!response || !response.events || response.events.length === 0) break
      for (const ev of response.events) {
        if (ev.type === 'deleted' && ev.workout_id) {
          await prisma.workout.deleteMany({ where: { user_id: userId, hevy_id: ev.workout_id } })
          syncedWorkouts++
        } else if (ev.type === 'updated' || ev.type === 'created' || ev.workout) {
          const id = await processAndSaveWorkout(userId, ev.workout || ev, activeMesocycle)
          if (id) { touchedWorkouts.push(id); syncedWorkouts++ }
        }
      }
      await onProgress?.('Aplicando cambios recientes', page, response.pageCount)
      if (response.events.length < 10 || page >= response.pageCount) break
      page++
    }
  }

  if (activeMesocycle) {
    const assigned = await prisma.workout.updateMany({
      where: { user_id: userId, mesocycle_id: null, date: { gte: activeMesocycle.start_date, lte: activeMesocycle.end_date ?? new Date() } },
      data: { mesocycle_id: activeMesocycle.id }
    })
    if (assigned.count > 0) console.log(`🔗 [user:${userId}] ${assigned.count} workouts asignados al mesociclo activo.`)
  }

  // ── Body metrics ──────────────────────────────────────────────────────────
  //
  // Always paginated, never day-by-day. The old incremental path issued one
  // request per calendar day since the last recorded metric, so three months
  // away from the app cost 90 sequential calls to fetch a handful of rows.
  // Paging newest-first and stopping at the last known date costs one or two.
  await onProgress?.('Leyendo medidas corporales')

  const lastMetric = await prisma.bodyMetric.findFirst({
    where: { user_id: userId },
    orderBy: { date: 'desc' },
    select: { date: true }
  })
  const stopAt = lastMetric?.date ?? null
  let syncedMetrics = 0

  console.log(`🔄 [user:${userId}] Sync métricas — ${stopAt ? `desde ${stopAt.toISOString().slice(0, 10)}` : 'Bootstrap'}`)

  let page = 1
  let pageCount = 1
  let reachedKnown = false

  while (page <= pageCount && !reachedKnown) {
    const metricsRes = await fetchHevyBodyMeasurements(hevyApiKey, page)
    if (!metricsRes?.data?.length) break
    pageCount = metricsRes.pageCount || 1

    for (const m of metricsRes.data) {
      // Hevy returns these newest-first; once we reach a date we already hold,
      // everything beyond it is already stored.
      if (stopAt && m?.date && new Date(`${m.date}T12:00:00.000Z`) < stopAt) {
        reachedKnown = true
        break
      }
      if (await processAndSaveBodyMetric(userId, m)) syncedMetrics++
    }
    await onProgress?.('Leyendo medidas corporales', page, pageCount)
    page++
  }

  // ── Records and alerts ────────────────────────────────────────────────────
  //
  // Run here rather than on a separate schedule: an alert must reflect the
  // workout that was just imported, not last night's state.
  await onProgress?.('Buscando récords')
  let newRecords = 0
  for (const workoutId of touchedWorkouts) {
    try {
      newRecords += await detectPersonalRecords(userId, workoutId)
    } catch (err) {
      console.error(`Error detectando récords en workout ${workoutId}:`, err)
    }
  }

  await onProgress?.('Analizando estancamiento y fatiga')
  let alerts = 0
  try {
    // Never let analysis failures fail the sync: the imported data is valuable
    // on its own, and a broken detector must not make the app unsyncable.
    const result = await runDetectors(userId)
    alerts = result.active
  } catch (err) {
    console.error(`Error ejecutando detectores para ${userId}:`, err)
  }

  console.log(`✅ [user:${userId}] Sync completado: ${syncedWorkouts} workouts, ${syncedMetrics} métricas, ${newRecords} récords, ${alerts} alertas`)
  return { syncedWorkouts, syncedMetrics, newRecords, alerts }
}
