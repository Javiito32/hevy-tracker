import { prisma } from './prisma'
import { fetchHevyWorkouts, fetchHevyWorkoutEvents, fetchHevyBodyMeasurements, fetchHevyBodyMeasurementByDate } from './hevy-client'
import { calcSetVolume, calcEstimated1RM, calcAverageRPE } from './volume-calculator'

function getAverage(v1?: number, v2?: number) {
  if (v1 != null && v2 != null) return (v1 + v2) / 2
  return v1 != null ? v1 : (v2 != null ? v2 : null)
}

async function processAndSaveBodyMetric(userId: string, data: any) {
  if (!data || !data.date) return false
  const dateStr = data.date
  const weight = data.weight_kg ?? null
  const fat = data.fat_percent ?? null
  const neck = data.neck_cm ?? null
  const chest = data.chest_cm ?? null
  const waist = data.waist ?? null
  const hips = data.hips ?? null
  const biceps = getAverage(data.left_bicep_cm, data.right_bicep_cm)
  const thighs = getAverage(data.left_thigh, data.right_thigh)
  const calves = getAverage(data.left_calf, data.right_calf)

  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`)
  const endOfDay = new Date(`${dateStr}T23:59:59.999Z`)

  const existing = await prisma.bodyMetric.findFirst({
    where: { user_id: userId, date: { gte: startOfDay, lt: endOfDay } }
  })

  if (existing) {
    await prisma.bodyMetric.update({
      where: { id: existing.id },
      data: { weight, body_fat_percentage: fat, neck, chest, waist, hips, biceps, thighs, calves, raw_data: JSON.stringify(data) }
    })
  } else {
    await prisma.bodyMetric.create({
      data: {
        user_id: userId,
        date: new Date(`${dateStr}T12:00:00.000Z`),
        weight, body_fat_percentage: fat, neck, chest, waist, hips, biceps, thighs, calves,
        raw_data: JSON.stringify(data)
      }
    })
  }
  return true
}

async function processAndSaveWorkout(userId: string, w: any, activeMesocycle?: { id: string; start_date: Date; end_date: Date | null } | null) {
  if (!w || !w.id) return false

  const startTime = new Date(w.start_time)
  const date = startTime
  const endTime = new Date(w.end_time)
  const duration = Math.floor((endTime.getTime() - startTime.getTime()) / 1000)

  let sessionTotalVolume = 0
  const allRpes: number[] = []
  const summary: any[] = []

  if (w.exercises && Array.isArray(w.exercises)) {
    w.exercises.forEach((ex: any) => {
      let exVolume = 0
      let max1RM = 0
      let exDuration = 0
      let exDistance = 0
      const sets: any[] = ex.sets && Array.isArray(ex.sets) ? ex.sets : []

      sets.forEach((set: any) => {
        const setVol = calcSetVolume(set.weight_kg, set.reps)
        exVolume += setVol
        sessionTotalVolume += setVol
        const set1rm = calcEstimated1RM(set.weight_kg, set.reps)
        if (set1rm && set1rm > max1RM) max1RM = set1rm
        if (set.rpe && set.rpe > 0) allRpes.push(set.rpe)
        if (set.duration_seconds) exDuration += set.duration_seconds
        if (set.distance_meters) exDistance += set.distance_meters
      })

      const hasWeight = sets.some((s: any) => s.weight_kg > 0)
      const hasReps = sets.some((s: any) => s.reps > 0)
      const hasDistance = sets.some((s: any) => s.distance_meters > 0)
      const hasDuration = sets.some((s: any) => s.duration_seconds > 0)
      const exType = (hasWeight || hasReps) ? 'strength' : hasDistance ? 'cardio' : hasDuration ? 'duration' : 'strength'

      summary.push({
        name: ex.title,
        type: exType,
        sets: sets.length,
        total_volume: exVolume,
        estimated_1rm: max1RM > 0 ? max1RM : null,
        total_duration_seconds: exDuration > 0 ? exDuration : null,
        total_distance_meters: exDistance > 0 ? exDistance : null,
        sets_details: sets.map((s: any) => ({
          weight: s.weight_kg ?? null,
          reps: s.reps ?? null,
          rpe: s.rpe || null,
          duration_seconds: s.duration_seconds ?? null,
          distance_meters: s.distance_meters ?? null,
        }))
      })
    })
  }

  const rpeAvg = allRpes.length > 0 ? calcAverageRPE(allRpes.map(r => ({ rpe: r }))) : null

  let mesocycleId: string | null = null
  if (activeMesocycle) {
    const afterStart = startTime >= new Date(activeMesocycle.start_date)
    const beforeEnd = !activeMesocycle.end_date || startTime <= new Date(activeMesocycle.end_date)
    if (afterStart && beforeEnd) mesocycleId = activeMesocycle.id
  }

  await prisma.workout.upsert({
    where: { user_id_hevy_id: { user_id: userId, hevy_id: w.id } },
    update: {
      name: w.title,
      description: w.description || null,
      total_volume: sessionTotalVolume,
      rpe_avg: rpeAvg,
      duration,
      exercises_summary: JSON.stringify(summary),
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
      total_volume: sessionTotalVolume,
      total_tonnage: sessionTotalVolume,
      rpe_avg: rpeAvg,
      exercises_summary: JSON.stringify(summary),
      raw_data: JSON.stringify(w),
      mesocycle_id: mesocycleId
    }
  })
  return true
}

export async function syncUserData(userId: string, hevyApiKey: string): Promise<{ syncedWorkouts: number; syncedMetrics: number }> {
  // ── Workouts ──────────────────────────────────────────────────────────────
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
        if (await processAndSaveWorkout(userId, w, activeMesocycle)) syncedWorkouts++
      }
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
          if (await processAndSaveWorkout(userId, ev.workout || ev, activeMesocycle)) syncedWorkouts++
        }
      }
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
  const existingMetricsCount = await prisma.bodyMetric.count({ where: { user_id: userId } })
  const useMetricsBootstrap = existingMetricsCount === 0
  let syncedMetrics = 0

  console.log(`🔄 [user:${userId}] Sync métricas — ${useMetricsBootstrap ? 'Bootstrap' : 'Incremental'}`)

  if (useMetricsBootstrap) {
    let page = 1
    let pageCount = 1
    while (page <= pageCount) {
      const metricsRes = await fetchHevyBodyMeasurements(hevyApiKey, page)
      if (!metricsRes || !metricsRes.data || metricsRes.data.length === 0) break
      for (const m of metricsRes.data) {
        if (await processAndSaveBodyMetric(userId, m)) syncedMetrics++
      }
      pageCount = metricsRes.pageCount || 1
      page++
    }
  } else {
    const lastMetric = await prisma.bodyMetric.findFirst({ where: { user_id: userId }, orderBy: { date: 'desc' } })
    if (lastMetric) {
      let current = new Date(lastMetric.date)
      current.setDate(current.getDate() + 1)
      const today = new Date()
      while (current <= today) {
        const yyyy = current.getFullYear()
        const mm = String(current.getMonth() + 1).padStart(2, '0')
        const dd = String(current.getDate()).padStart(2, '0')
        const metricData = await fetchHevyBodyMeasurementByDate(hevyApiKey, `${yyyy}-${mm}-${dd}`)
        if (metricData) {
          if (await processAndSaveBodyMetric(userId, metricData)) syncedMetrics++
        }
        current.setDate(current.getDate() + 1)
      }
    }
  }

  console.log(`✅ [user:${userId}] Sync completado: ${syncedWorkouts} workouts, ${syncedMetrics} métricas`)
  return { syncedWorkouts, syncedMetrics }
}
