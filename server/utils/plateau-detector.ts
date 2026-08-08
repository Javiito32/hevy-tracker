import { prisma } from './prisma'
import { buildMuscleVolumeReport } from './muscle-volume'
import { muscleLabel, VOLUME_LANDMARKS } from './muscle-groups'

/**
 * Detects stalled progress and accumulated fatigue.
 *
 * This is the app's stated purpose, and until now it happened only when the
 * athlete opened the chat and asked. Everything here runs after each sync so
 * the diagnosis is waiting for them instead.
 *
 * Every detector states its evidence in `payload_json`. A verdict the athlete
 * can't audit is one they will either over-trust or ignore, and both are worse
 * than a number they can check.
 */

// ── Tunables ────────────────────────────────────────────────────────────────
/** Sessions of an exercise needed before a trend means anything. */
const MIN_SESSIONS_FOR_TREND = 4
/** A plateau needs time as well as sessions: 3 sessions in one week is noise. */
const MIN_DAYS_FOR_PLATEAU = 21
/** Window scanned for exercise trends. */
const TREND_WEEKS = 10
/** Two loads within this fraction count as "the same weight" for RPE drift. */
const SAME_LOAD_TOLERANCE = 0.025
/** RPE rise at matched load that counts as fatigue. */
const RPE_DRIFT_THRESHOLD = 1
/** Weeks of training before a deload becomes worth suggesting. */
const WEEKS_BEFORE_DELOAD = 5
/** HRV this far below its own 30-day mean reads as unrecovered. */
const HRV_DROP_FRACTION = 0.08

export interface DetectedAlert {
  type: 'plateau' | 'fatigue' | 'undertrained' | 'deload_due' | 'overreaching'
  subject_kind: 'exercise' | 'muscle_group' | 'global'
  subject: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  detail: string
  payload: Record<string, unknown>
}

/** Least-squares slope of y over x. Returns null when x has no spread. */
export function linearSlope(points: Array<{ x: number; y: number }>): { slope: number; r2: number } | null {
  const n = points.length
  if (n < 2) return null

  const meanX = points.reduce((s, p) => s + p.x, 0) / n
  const meanY = points.reduce((s, p) => s + p.y, 0) / n

  let sxy = 0, sxx = 0, syy = 0
  for (const p of points) {
    const dx = p.x - meanX
    const dy = p.y - meanY
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0) return null

  const slope = sxy / sxx
  // r² is reported so a "trend" derived from scattered points can be
  // discounted rather than presented with the same confidence as a clean one.
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy)
  return { slope, r2 }
}

// ── Detectors ───────────────────────────────────────────────────────────────

/**
 * An exercise whose estimated 1RM has stopped rising.
 *
 * Slope is per day, converted to "kg per month" for the message because that is
 * the unit an athlete can act on.
 */
async function detectPlateaus(userId: string): Promise<DetectedAlert[]> {
  const since = new Date()
  since.setDate(since.getDate() - TREND_WEEKS * 7)

  const rows = await prisma.workoutExercise.findMany({
    where: { user_id: userId, date: { gte: since }, best_e1rm: { not: null } },
    select: { name: true, date: true, best_e1rm: true, avg_rpe: true },
    orderBy: { date: 'asc' }
  })

  const byExercise = new Map<string, Array<{ date: Date; e1rm: number; rpe: number | null }>>()
  for (const r of rows) {
    if (r.best_e1rm == null) continue
    const list = byExercise.get(r.name) ?? []
    list.push({ date: r.date, e1rm: r.best_e1rm, rpe: r.avg_rpe })
    byExercise.set(r.name, list)
  }

  const alerts: DetectedAlert[] = []

  for (const [name, sessions] of byExercise) {
    if (sessions.length < MIN_SESSIONS_FOR_TREND) continue

    const first = sessions[0].date.getTime()
    const spanDays = (sessions[sessions.length - 1].date.getTime() - first) / 86_400_000
    if (spanDays < MIN_DAYS_FOR_PLATEAU) continue

    const fit = linearSlope(sessions.map(s => ({
      x: (s.date.getTime() - first) / 86_400_000,
      y: s.e1rm
    })))
    if (!fit || fit.slope > 0) continue

    const perMonth = fit.slope * 30
    const best = Math.max(...sessions.map(s => s.e1rm))
    const latest = sessions[sessions.length - 1].e1rm
    const declining = perMonth < -0.5

    alerts.push({
      type: 'plateau',
      subject_kind: 'exercise',
      subject: name,
      severity: declining ? 'warning' : 'info',
      title: declining ? `${name} está retrocediendo` : `${name} lleva estancado`,
      detail: declining
        ? `El 1RM estimado cae ${Math.abs(perMonth).toFixed(1)} kg/mes en las últimas ${sessions.length} sesiones (${Math.round(spanDays)} días). Mejor marca del periodo: ${best.toFixed(1)} kg; última: ${latest.toFixed(1)} kg.`
        : `El 1RM estimado no sube desde hace ${Math.round(spanDays)} días (${sessions.length} sesiones). Se mantiene en torno a ${latest.toFixed(1)} kg.`,
      payload: {
        sessions: sessions.length,
        span_days: Math.round(spanDays),
        slope_kg_per_month: Math.round(perMonth * 100) / 100,
        r2: Math.round(fit.r2 * 100) / 100,
        best_e1rm: best,
        latest_e1rm: latest
      }
    })
  }

  return alerts
}

/**
 * RPE rising at a load the athlete has handled before.
 *
 * The cleanest fatigue signal available from this data: if 100x8 felt like RPE 7
 * three weeks ago and RPE 9 now, nothing about the prescription changed but the
 * athlete's capacity to meet it did.
 */
async function detectRpeDrift(userId: string): Promise<DetectedAlert[]> {
  const since = new Date()
  since.setDate(since.getDate() - TREND_WEEKS * 7)

  const rows = await prisma.workoutExercise.findMany({
    where: { user_id: userId, date: { gte: since } },
    select: {
      name: true, date: true,
      sets: { select: { set_type: true, weight_kg: true, reps: true, rpe: true } }
    },
    orderBy: { date: 'asc' }
  })

  interface Point { date: Date; weight: number; reps: number; rpe: number }
  const byExercise = new Map<string, Point[]>()

  for (const ex of rows) {
    for (const s of ex.sets) {
      if (s.set_type === 'warmup') continue
      if (!s.weight_kg || !s.reps || !s.rpe) continue
      const list = byExercise.get(ex.name) ?? []
      list.push({ date: ex.date, weight: s.weight_kg, reps: s.reps, rpe: s.rpe })
      byExercise.set(ex.name, list)
    }
  }

  const alerts: DetectedAlert[] = []

  for (const [name, points] of byExercise) {
    if (points.length < 4) continue

    // Compare the most recent sets against earlier ones at a matched load and
    // rep count. Without matching reps the comparison is meaningless: 100x5 at
    // RPE 7 and 100x10 at RPE 9 are not the same effort.
    const latest = points[points.length - 1]
    const matches = points.filter(p =>
      p !== latest &&
      Math.abs(p.weight - latest.weight) <= latest.weight * SAME_LOAD_TOLERANCE &&
      Math.abs(p.reps - latest.reps) <= 1 &&
      p.date < latest.date
    )
    if (matches.length === 0) continue

    const baselineRpe = matches.reduce((s, p) => s + p.rpe, 0) / matches.length
    const drift = latest.rpe - baselineRpe
    if (drift < RPE_DRIFT_THRESHOLD) continue

    alerts.push({
      type: 'fatigue',
      subject_kind: 'exercise',
      subject: name,
      severity: drift >= 2 ? 'warning' : 'info',
      title: `${name} te cuesta más a la misma carga`,
      detail: `${latest.weight} kg × ${latest.reps} lo registraste a RPE ${latest.rpe}, frente a RPE ${baselineRpe.toFixed(1)} de media en ${matches.length} ${matches.length === 1 ? 'sesión' : 'sesiones'} anteriores con la misma carga. Es fatiga acumulada, no pérdida de fuerza.`,
      payload: {
        weight_kg: latest.weight,
        reps: latest.reps,
        latest_rpe: latest.rpe,
        baseline_rpe: Math.round(baselineRpe * 10) / 10,
        drift: Math.round(drift * 10) / 10,
        comparisons: matches.length
      }
    })
  }

  return alerts
}

/** Muscle groups sitting under MEV across the recent block. */
async function detectUndertrained(userId: string): Promise<DetectedAlert[]> {
  const report = await buildMuscleVolumeReport(userId, 4)

  // With almost nothing classified, every muscle looks under-trained. Say
  // nothing rather than blame the athlete for a gap in the catalogue.
  if (report.coverage.total_sets === 0) return []
  const coverage = report.coverage.classified_sets / report.coverage.total_sets
  if (coverage < 0.5) return []

  const trained = new Set(report.averages.map(a => a.muscle))

  return report.averages
    .filter(a => a.verdict === 'below_mev' && a.landmarks && trained.has(a.muscle))
    .map(a => ({
      type: 'undertrained' as const,
      subject_kind: 'muscle_group' as const,
      subject: a.muscle,
      severity: 'info' as const,
      title: `${muscleLabel(a.muscle)} por debajo del mínimo`,
      detail: `Promedias ${a.avg_sets} series semanales de ${muscleLabel(a.muscle).toLowerCase()} en las últimas semanas, por debajo del mínimo efectivo de ${a.landmarks!.mev}. Añadir 2-4 series semanales es el ajuste más directo.`,
      payload: {
        avg_weekly_sets: a.avg_sets,
        mev: a.landmarks!.mev,
        mav: a.landmarks!.mav,
        coverage: Math.round(coverage * 100) / 100
      }
    }))
}

/**
 * Whether a deload is due — the one call that combines every signal.
 *
 * Requires at least two independent indications. A single stalled lift is
 * normal variance; stalled lifts plus rising RPE plus depressed HRV is a
 * pattern, and only the pattern justifies telling someone to back off.
 */
async function detectDeloadNeed(
  userId: string,
  plateaus: DetectedAlert[],
  fatigue: DetectedAlert[]
): Promise<DetectedAlert[]> {
  const mesocycle = await prisma.mesocycle.findFirst({
    where: { user_id: userId, status: 'active' },
    select: { start_date: true, id: true }
  })

  const signals: string[] = []
  const payload: Record<string, unknown> = {}

  const stalledLifts = plateaus.length
  if (stalledLifts >= 2) {
    signals.push(`${stalledLifts} ejercicios sin progresar`)
    payload.stalled_exercises = plateaus.map(p => p.subject)
  }

  if (fatigue.length >= 1) {
    signals.push(`RPE al alza a carga constante en ${fatigue.length} ${fatigue.length === 1 ? 'ejercicio' : 'ejercicios'}`)
    payload.rpe_drift_exercises = fatigue.map(f => f.subject)
  }

  // HRV against its own 30-day mean. Absolute HRV is individual to the point of
  // being meaningless across people; the deviation from personal baseline isn't.
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const metrics = await prisma.bodyMetric.findMany({
    where: { user_id: userId, date: { gte: since }, hrv: { not: null } },
    select: { date: true, hrv: true },
    orderBy: { date: 'desc' }
  })
  if (metrics.length >= 7) {
    const values = metrics.map(m => m.hrv as number)
    const mean = values.reduce((s, v) => s + v, 0) / values.length
    const recent = values.slice(0, 3)
    const recentMean = recent.reduce((s, v) => s + v, 0) / recent.length
    if (mean > 0 && recentMean < mean * (1 - HRV_DROP_FRACTION)) {
      signals.push(`HRV ${Math.round((1 - recentMean / mean) * 100)}% por debajo de tu media de 30 días`)
      payload.hrv_recent = Math.round(recentMean * 10) / 10
      payload.hrv_baseline = Math.round(mean * 10) / 10
    }
  }

  let weeksIn = 0
  if (mesocycle) {
    weeksIn = Math.floor((Date.now() - new Date(mesocycle.start_date).getTime()) / (7 * 86_400_000))
    payload.weeks_in_block = weeksIn
    if (weeksIn >= WEEKS_BEFORE_DELOAD) signals.push(`${weeksIn} semanas acumuladas de bloque`)
  }

  if (signals.length < 2) return []

  return [{
    type: 'deload_due',
    subject_kind: 'global',
    subject: '',
    severity: signals.length >= 3 ? 'warning' : 'info',
    title: 'Puede tocar descarga',
    detail: `Coinciden ${signals.length} señales: ${signals.join('; ')}. Una semana al 50-60% del volumen habitual manteniendo la intensidad suele bastar.`,
    payload: { ...payload, signals }
  }]
}

// ── Persistence ─────────────────────────────────────────────────────────────

/**
 * Runs every detector and reconciles the result against stored alerts.
 *
 * Reconciliation matters more than detection: an alert still true keeps its
 * original `detected_at` (so "lleva 3 semanas" stays honest), one no longer
 * true is resolved rather than deleted, and one the athlete dismissed stays
 * dismissed until it actually clears.
 */
export async function runDetectors(userId: string): Promise<{ active: number; resolved: number }> {
  const [plateaus, fatigue] = await Promise.all([
    detectPlateaus(userId),
    detectRpeDrift(userId)
  ])
  const undertrained = await detectUndertrained(userId)
  const deload = await detectDeloadNeed(userId, plateaus, fatigue)

  const detected = [...plateaus, ...fatigue, ...undertrained, ...deload]
  const detectedKeys = new Set(detected.map(a => `${a.type}|${a.subject}`))

  const existing = await prisma.trainingAlert.findMany({ where: { user_id: userId } })
  const existingByKey = new Map(existing.map(a => [`${a.type}|${a.subject}`, a]))

  for (const alert of detected) {
    const key = `${alert.type}|${alert.subject}`
    const prior = existingByKey.get(key)

    if (prior?.status === 'dismissed') {
      // Leave it dismissed, but keep the evidence current so that if the
      // athlete reopens it they see today's numbers, not the ones they dismissed.
      await prisma.trainingAlert.update({
        where: { id: prior.id },
        data: { detail: alert.detail, payload_json: JSON.stringify(alert.payload) }
      })
      continue
    }

    await prisma.trainingAlert.upsert({
      where: { user_id_type_subject: { user_id: userId, type: alert.type, subject: alert.subject } },
      update: {
        severity: alert.severity,
        title: alert.title,
        detail: alert.detail,
        payload_json: JSON.stringify(alert.payload),
        status: 'active',
        resolved_at: null
      },
      create: {
        user_id: userId,
        type: alert.type,
        subject_kind: alert.subject_kind,
        subject: alert.subject,
        severity: alert.severity,
        title: alert.title,
        detail: alert.detail,
        payload_json: JSON.stringify(alert.payload),
        status: 'active'
      }
    })
  }

  const stale = existing.filter(a => a.status === 'active' && !detectedKeys.has(`${a.type}|${a.subject}`))
  if (stale.length > 0) {
    await prisma.trainingAlert.updateMany({
      where: { id: { in: stale.map(a => a.id) } },
      data: { status: 'resolved', resolved_at: new Date() }
    })
  }

  return { active: detected.length, resolved: stale.length }
}
