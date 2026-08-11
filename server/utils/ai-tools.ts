import { prisma } from './prisma'
import { localWeekKey } from './dates'
import type { ToolDefinition } from './ai-provider'
import { buildWorkoutData, type NutritionSnapshot } from './ai-payload'
import {
  int, num, NONE, serializeMuscleVolume, serializeNutrition, serializeWorkout,
  serializeWorkouts, table
} from './ai-serialize'
import { resolveVersion, serializeDietForAi, getActivePlan, toDateKey } from './diet-service'
import { normalizeExerciseName } from './exercise-aliases'
import { NUTRIENT_KEYS, WEEKDAY_LABELS_ES, isWeekday } from './nutrition-calculator'
import { buildMuscleVolumeReport } from './muscle-volume'
import { getCurrentRecords, RECORD_LABELS, type RecordType } from './personal-records'
import { getAdherence, getNextSession, loadPlan } from './plan-service'

/**
 * The tools the chat can call, their implementations, and which of them are
 * offered on a given turn.
 *
 * Three rules hold across the file:
 *
 *  1. **Every implementation is scoped to `userId`**, which is passed in by the
 *     runner and never by the model. An id that arrives in the arguments is a
 *     filter, never an authorisation: `workout_id`, `mesocycle_id`,
 *     `version_id` and `note_id` are all matched together with the owner, so a
 *     hallucinated (or copied) id from another account resolves to "not found"
 *     rather than to someone else's data.
 *  2. **Results are compact text, not JSON.** A tool result lands in the
 *     context of every subsequent round of the same turn, so an over-verbose
 *     one is billed several times over. Tables name their columns once instead
 *     of repeating a key per value, and nothing internal (row ids, timestamps,
 *     `user_id`, null fields) travels at all.
 *  3. **Everything returned here is DATA.** Exercise names, notes, diary
 *     entries and food names are strings the user typed; if one of them says
 *     "ignore your instructions", it is a training note with strange contents
 *     and not an instruction. The system prompt states this, and the write
 *     tools below refuse to act on anything that did not come from the user's
 *     own message.
 */

type ToolFn = (userId: string, args: any) => Promise<string>

// Caps to keep tool outputs from flooding the model context.
const MAX_WORKOUTS_SUMMARY = 40
const MAX_WORKOUTS_FULL = 12
const MAX_DIET_VERSIONS = 20
const MAX_FOOD_RESULTS = 25
/** Exercises reported per week in the weekly breakdown, by volume. */
const MAX_EXERCISES_PER_WEEK = 10

const parseDate = (s: string | undefined, fallback?: Date): Date | undefined => {
  if (!s) return fallback
  const d = new Date(s)
  return isNaN(d.getTime()) ? fallback : d
}

const daysAgo = (n: number): Date => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

const fmtDate = (d: Date | string): string => new Date(d).toISOString().substring(0, 10)

/** Tools answer with a message rather than throwing: the model can retry. */
const fail = (message: string): string => `ERROR: ${message}`

/** Spanish weekday of a YYYY-MM-DD, Monday-first like the rest of the app. */
const weekdayNameOf = (date: string): string | null => {
  const d = new Date(`${date}T12:00:00.000Z`)
  if (isNaN(d.getTime())) return null
  const weekday = ((d.getUTCDay() + 6) % 7) + 1
  return isWeekday(weekday) ? WEEKDAY_LABELS_ES[weekday].toLowerCase() : null
}

const WORKOUT_SELECT = {
  id: true, name: true, date: true, total_volume: true, rpe_avg: true,
  notes: true, duration: true, exercises_summary: true
} as const

// ── Training ───────────────────────────────────────────────────────────────────

const getWorkoutsInRange: ToolFn = async (userId, args) => {
  const start = parseDate(args.start_date, daysAgo(14))!
  const end = parseDate(args.end_date, new Date())!
  const detail = args.detail === 'full' ? 'full' : 'summary'
  const cap = detail === 'full' ? MAX_WORKOUTS_FULL : MAX_WORKOUTS_SUMMARY

  const workouts = await prisma.workout.findMany({
    where: { user_id: userId, date: { gte: start, lte: end } },
    orderBy: { date: 'desc' },
    take: cap + 1,
    select: WORKOUT_SELECT
  })
  const truncated = workouts.length > cap
  const visible = workouts.slice(0, cap).reverse()

  if (!visible.length) return `Sin entrenamientos entre ${fmtDate(start)} y ${fmtDate(end)}.`

  const header = `ENTRENOS ${fmtDate(start)} → ${fmtDate(end)} · ${visible.length} sesiones` +
    (truncated
      ? `\nTRUNCADO: solo las ${cap} más recientes del rango. Pide un rango más corto${detail === 'full' ? ' o usa detail=summary' : ''} para el resto.`
      : '')

  return `${header}\n\n${serializeWorkouts(
    visible.map(w => buildWorkoutData(w, true)),
    { detail: detail === 'full' ? 'sets' : 'exercises' }
  )}`
}

const getWorkoutDetail: ToolFn = async (userId, args) => {
  if (!args.workout_id && !args.date) return fail('workout_id o date es requerido')

  // user_id is part of the lookup, not checked afterwards: another athlete's
  // workout id simply doesn't match.
  const where: any = { user_id: userId }
  if (args.workout_id) where.id = args.workout_id
  if (args.date) {
    const day = parseDate(args.date)!
    const next = new Date(day); next.setDate(next.getDate() + 1)
    where.date = { gte: day, lt: next }
  }

  const w = await prisma.workout.findFirst({ where, orderBy: { date: 'desc' }, select: WORKOUT_SELECT })
  if (!w) return 'Entrenamiento no encontrado (no existe o no es de este usuario).'
  return serializeWorkout(buildWorkoutData(w, true), { detail: 'sets' })
}

const listExercises: ToolFn = async (userId, args) => {
  const weeksBack = Math.min(Math.max(Number(args.weeks_back) || 52, 1), 156)
  const since = daysAgo(weeksBack * 7)
  const workouts = await prisma.workout.findMany({
    where: { user_id: userId, date: { gte: since } },
    orderBy: { date: 'asc' },
    select: { date: true, exercises_summary: true }
  })

  const map = new Map<string, { sessions: number; last_date: string; best_1rm: number | null; type: string }>()
  for (const w of workouts) {
    if (!w.exercises_summary) continue
    let exs: any[]
    try { exs = JSON.parse(w.exercises_summary) } catch { continue }
    for (const ex of exs) {
      const existing = map.get(ex.name)
      const rm = ex.estimated_1rm ? parseFloat(ex.estimated_1rm) : null
      if (!existing) {
        map.set(ex.name, { sessions: 1, last_date: fmtDate(w.date), best_1rm: rm, type: ex.type || 'strength' })
      } else {
        existing.sessions++
        if (fmtDate(w.date) > existing.last_date) existing.last_date = fmtDate(w.date)
        if (rm != null && (existing.best_1rm == null || rm > existing.best_1rm)) existing.best_1rm = rm
      }
    }
  }
  if (!map.size) return `Sin ejercicios registrados en las últimas ${weeksBack} semanas.`

  return `EJERCICIOS REGISTRADOS (${map.size}, últimas ${weeksBack} semanas)\n` + table(
    ['ejercicio', 'tipo', 'sesiones', 'última', 'mejor_e1RM_kg'],
    [...map.entries()]
      .sort((a, b) => b[1].sessions - a[1].sessions)
      .map(([name, s]) => [name, s.type, s.sessions, s.last_date, s.best_1rm != null ? num(s.best_1rm) : null])
  )
}

const getExerciseProgression: ToolFn = async (userId, args) => {
  const query = (args.exercise_name || '').toString().trim()
  if (!query) return fail('exercise_name es requerido')
  const needle = normalizeExerciseName(query)
  const weeksBack = Math.min(Math.max(Number(args.weeks_back) || 12, 1), 52)
  const since = daysAgo(weeksBack * 7)

  const workouts = await prisma.workout.findMany({
    where: { user_id: userId, date: { gte: since } },
    orderBy: { date: 'asc' },
    select: { date: true, exercises_summary: true }
  })

  // Two passes: prefer exact-name matches so a generic query like "remo" doesn't
  // silently mix sessions from different exercises. Fall back to substring match.
  const parsed = workouts
    .map(w => {
      if (!w.exercises_summary) return null
      try { return { date: w.date, exs: JSON.parse(w.exercises_summary) as any[] } } catch { return null }
    })
    .filter(Boolean) as Array<{ date: Date; exs: any[] }>

  const hasExact = parsed.some(w => w.exs.some(e => normalizeExerciseName(String(e.name)) === needle))
  const matchedNames = new Set<string>()
  const rows: Array<Array<string | number | null>> = []

  for (const w of parsed) {
    const match = hasExact
      ? w.exs.find(e => normalizeExerciseName(String(e.name)) === needle)
      : w.exs.find(e => normalizeExerciseName(String(e.name)).includes(needle))
    if (!match) continue
    matchedNames.add(match.name)

    const details: any[] = match.sets_details || []
    const working = details.filter(s => s?.type !== 'warmup')
    const best = working.length
      ? working.reduce((a: any, b: any) =>
          ((b?.weight ?? 0) * (b?.reps ?? 0)) > ((a?.weight ?? 0) * (a?.reps ?? 0)) ? b : a)
      : null

    rows.push([
      fmtDate(w.date),
      match.sets ?? null,
      match.total_volume ? int(Number(match.total_volume)) : null,
      match.estimated_1rm ? num(parseFloat(match.estimated_1rm)) : null,
      best ? `${num(best.weight)}×${best.reps ?? NONE}${best.rpe ? `@${num(best.rpe)}` : ''}` : null
    ])
  }

  if (!rows.length) {
    return `Sin sesiones de "${query}" en las últimas ${weeksBack} semanas. Usa list_exercises para ver el nombre exacto.`
  }

  const header = `PROGRESIÓN "${query}" · ${rows.length} sesiones · últimas ${weeksBack} semanas\n` +
    `coincide con: ${[...matchedNames].join(', ')}` +
    (matchedNames.size > 1
      ? '\nAVISO: la búsqueda coincide con varios ejercicios distintos y las sesiones están mezcladas. Usa list_exercises y repite con el nombre exacto.'
      : '')

  return `${header}\n${table(['fecha', 'series', 'vol_kg', 'e1RM_kg', 'mejor serie'], rows)}`
}

const getWeeklyAggregates: ToolFn = async (userId, args) => {
  const weeksBack = Math.min(Math.max(Number(args.weeks_back) || 8, 1), 26)
  const since = daysAgo(weeksBack * 7)
  const workouts = await prisma.workout.findMany({
    where: { user_id: userId, date: { gte: since } },
    orderBy: { date: 'asc' },
    select: { date: true, total_volume: true, rpe_avg: true, exercises_summary: true }
  })

  const byWeek = new Map<string, { volumes: number[]; rpes: number[]; count: number; exercises: Map<string, { sets: number; volume: number }> }>()
  for (const w of workouts) {
    const key = localWeekKey(new Date(w.date))
    if (!byWeek.has(key)) byWeek.set(key, { volumes: [], rpes: [], count: 0, exercises: new Map() })
    const bucket = byWeek.get(key)!
    bucket.count++
    if (w.total_volume) bucket.volumes.push(Number(w.total_volume))
    if (w.rpe_avg) bucket.rpes.push(Number(w.rpe_avg))
    if (!w.exercises_summary) continue
    let exs: any[]
    try { exs = JSON.parse(w.exercises_summary) } catch { continue }
    for (const ex of exs) {
      if (!bucket.exercises.has(ex.name)) bucket.exercises.set(ex.name, { sets: 0, volume: 0 })
      const e = bucket.exercises.get(ex.name)!
      e.sets += ex.sets ?? 0
      e.volume += ex.total_volume ? Math.round(Number(ex.total_volume)) : 0
    }
  }
  if (!byWeek.size) return `Sin entrenamientos en las últimas ${weeksBack} semanas.`

  const weeks = [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const summary = table(
    ['semana', 'sesiones', 'vol_kg', 'RPE medio'],
    weeks.map(([week, b]) => [
      week,
      b.count,
      int(b.volumes.reduce((s, v) => s + v, 0)),
      b.rpes.length ? num(b.rpes.reduce((s, v) => s + v, 0) / b.rpes.length, 2) : null
    ])
  )

  const detail = weeks.flatMap(([week, b]) =>
    [...b.exercises.entries()]
      .sort((a, b2) => b2[1].volume - a[1].volume)
      .slice(0, MAX_EXERCISES_PER_WEEK)
      .map(([name, s]) => [week, name, s.sets, int(s.volume)])
  )

  return `AGREGADOS SEMANALES · últimas ${weeksBack} semanas\n${summary}\n\n` +
    `por ejercicio (top ${MAX_EXERCISES_PER_WEEK} de cada semana por volumen):\n` +
    table(['semana', 'ejercicio', 'series', 'vol_kg'], detail)
}

const getVolumeByMuscleGroup: ToolFn = async (userId, args) => {
  const weeks = Math.min(26, Math.max(1, Number(args.weeks_back) || 8))
  const report = await buildMuscleVolumeReport(userId, weeks)

  const coverage = report.coverage.total_sets > 0
    ? report.coverage.classified_sets / report.coverage.total_sets
    : 0

  const parts = [
    `VOLUMEN POR GRUPO MUSCULAR · últimas ${weeks} semanas`,
    // Shipped with the numbers, never after them: with poor coverage the low
    // figures are a gap in the exercise catalogue, not evidence the athlete
    // skipped a muscle.
    `cobertura de clasificación: ${Math.round(coverage * 100)}% de las series` +
      (coverage < 0.8
        ? `\nAVISO: los ejercicios sin clasificar (${report.unclassified.slice(0, 5).map(u => u.name).join(', ')}) no cuentan en ningún grupo. No interpretes un volumen bajo como falta de entrenamiento sin avisar de esta limitación.`
        : ''),
    'medias semanales (series efectivas: primario 1, secundario 0,5):\n' + serializeMuscleVolume(
      report.averages.map(a => ({
        muscle: a.muscle,
        label: a.label,
        avg_weekly_sets: a.avg_sets,
        verdict: a.verdict,
        ...(a.landmarks && { mev: a.landmarks.mev, mav: a.landmarks.mav, mrv: a.landmarks.mrv })
      }))
    ),
    'series por semana y grupo:\n' + table(
      ['semana', 'sesiones', 'series por grupo'],
      report.weeks.map(w => [
        w.week,
        w.sessions,
        w.muscles.map(m => `${m.muscle} ${num(m.sets)}`).join(' · ')
      ])
    )
  ]

  if (report.unclassified.length) {
    parts.push(`sin clasificar: ${report.unclassified.slice(0, 15).map((u: any) => u.name).join(', ')}`)
  }
  return parts.filter(Boolean).join('\n\n')
}

const getTrainingAlerts: ToolFn = async (userId, args) => {
  const includeDismissed = args.include_dismissed === true
  const alerts = await prisma.trainingAlert.findMany({
    where: { user_id: userId, status: includeDismissed ? { in: ['active', 'dismissed'] } : 'active' },
    orderBy: { detected_at: 'desc' },
    take: 30
  })
  if (!alerts.length) return 'Sin alertas activas: los detectores no han encontrado estancamiento, fatiga, déficit de volumen ni necesidad de descarga.'

  return `ALERTAS (${alerts.length})\n` + alerts.map(a => {
    const days = Math.max(0, Math.floor((Date.now() - a.detected_at.getTime()) / 86_400_000))
    // The evidence, so the coach argues from numbers instead of restating the
    // label the detector already wrote.
    const evidence = a.payload_json
      ? (() => { try { return JSON.stringify(JSON.parse(a.payload_json!)) } catch { return null } })()
      : null
    return [
      `- [${a.type}${a.subject ? ` · ${a.subject}` : ''}] ${a.title} · ${a.severity} · abierta hace ${days} d${a.status === 'dismissed' ? ' · DESCARTADA por el usuario' : ''}`,
      a.detail ? `  ${a.detail}` : null,
      evidence ? `  datos: ${evidence}` : null
    ].filter(Boolean).join('\n')
  }).join('\n')
}

const getPersonalRecords: ToolFn = async (userId, args) => {
  const exercise = args.exercise_name ? String(args.exercise_name) : undefined
  const current = await getCurrentRecords(userId, exercise)
  if (!current.length) return 'Sin récords registrados.'

  return `RÉCORDS VIGENTES (${current.length})\n` + table(
    ['ejercicio', 'tipo', 'valor', 'a peso_kg', 'marca anterior', 'mejora', 'fecha'],
    current
      .sort((a, b) => b.achieved_at.getTime() - a.achieved_at.getTime())
      .slice(0, 40)
      .map(r => [
        r.exercise_name,
        RECORD_LABELS[r.type as RecordType] ?? r.type,
        num(r.value, 2),
        r.at_weight != null ? num(r.at_weight) : null,
        r.previous_value != null ? num(r.previous_value, 2) : null,
        r.previous_value != null ? num(r.value - r.previous_value, 2) : null,
        fmtDate(r.achieved_at)
      ])
  )
}

// ── Plan ───────────────────────────────────────────────────────────────────────

/** The mesocycle the model asked about, or the active one. Always user-scoped. */
async function resolveMesocycle(userId: string, mesocycleId?: string) {
  if (mesocycleId) {
    return prisma.mesocycle.findFirst({ where: { id: mesocycleId, user_id: userId } })
  }
  return prisma.mesocycle.findFirst({ where: { user_id: userId, status: 'active' } })
}

/**
 * The prescription itself.
 *
 * Before this existed the chat could see `split_description` — prose derived
 * from the plan — and nothing else, so "¿cuántas series de pecho tengo
 * planificadas?" had to be inferred from what the athlete had already trained,
 * which answers a different question. The structured plan is the only place
 * that distinguishes what was prescribed from what was done, and adherence is
 * exactly that comparison.
 */
const getActivePlanTool: ToolFn = async (userId, args) => {
  const meso = await resolveMesocycle(userId, args.mesocycle_id)
  if (!meso) return 'No hay ningún mesociclo activo (y no se ha indicado mesocycle_id).'

  const plan = await loadPlan(meso.id, userId)
  if (!plan.has_plan) {
    return `El mesociclo "${meso.name}" no tiene plan estructurado. Solo hay descripción en texto:\n${meso.split_description ?? 'sin descripción'}`
  }

  const parts = [
    `PLAN · ${meso.name}${meso.goal ? ` · objetivo: ${meso.goal}` : ''} · empezó ${fmtDate(meso.start_date)}`,
    plan.weeks.length
      ? 'semanas del bloque:\n' + table(
          ['semana', 'descarga', 'RIR objetivo', 'x volumen', 'notas'],
          plan.weeks.map((w: any) => [w.week_number, w.is_deload ? 'sí' : '', w.target_rir ?? null, num(w.volume_multiplier), w.notes ?? null])
        )
      : null,
    ...plan.sessions.map((s: any) => {
      const weekday = s.day_of_week
      const day = isWeekday(weekday) ? WEEKDAY_LABELS_ES[weekday] : 'sin día fijo'
      return `### ${s.name} · ${day}${s.notes ? ` · ${s.notes}` : ''}\n` + table(
        ['ejercicio', 'series', 'reps', 'RIR', 'descanso_s'],
        s.exercises.map((e: any) => [
          e.name,
          e.target_sets,
          e.rep_min && e.rep_max ? (e.rep_min === e.rep_max ? `${e.rep_min}` : `${e.rep_min}-${e.rep_max}`) : null,
          e.target_rir ?? null,
          e.rest_seconds ?? null
        ])
      )
    })
  ]

  if (args.include_adherence !== false) {
    const adherence = await getAdherence(userId, meso.id)
    if (adherence.has_plan) {
      parts.push(
        `ADHERENCIA (series hechas frente a prescritas, ${adherence.weeks_elapsed} semanas transcurridas; global ${adherence.overall_pct ?? NONE}%)\n` +
        table(
          ['sesión', 'ejercicio', 'series prescritas', 'series hechas', '%'],
          adherence.rows.map(r => [r.session, r.exercise, r.planned_sets_to_date, r.actual_sets, r.adherence_pct ?? null])
        )
      )
    }
  }

  return parts.filter(Boolean).join('\n\n')
}

const REASON_TEXT: Record<string, string> = {
  weekday: 'el plan asigna esta sesión a hoy y aún no se ha entrenado',
  next_weekday: 'hoy no toca (o ya se entrenó): es el próximo día que el plan asigna',
  rotation: 'el plan no asigna días, así que sigue la rotación desde la última sesión entrenada',
  start: 'primera sesión del bloque; todavía no hay nada entrenado'
}

const getNextPlannedSession: ToolFn = async (userId, args) => {
  const meso = await resolveMesocycle(userId, args.mesocycle_id)
  if (!meso) return 'No hay ningún mesociclo activo (y no se ha indicado mesocycle_id).'

  const next = await getNextSession(userId, meso.id)
  if (!next.has_plan) return `El mesociclo "${meso.name}" no tiene plan estructurado.`

  const head = [
    `SIGUIENTE SESIÓN · ${next.session.name} · semana ${next.week}${next.is_deload ? ' (DESCARGA)' : ''}`,
    `por qué: ${REASON_TEXT[next.reason] ?? next.reason}`,
    next.trained_today ? 'ya se ha entrenado hoy.' : null,
    next.last_trained
      ? `última sesión entrenada: ${next.last_trained.session_name} (registrada como "${next.last_trained.workout_name}") el ${fmtDate(next.last_trained.date)}`
      : null,
    next.week_notes ? `notas de la semana: ${next.week_notes}` : null,
    // Said out loud because the plan cannot know about a session that never
    // reached Hevy, and the athlete is the only one who can spot that.
    'Basado solo en lo sincronizado desde Hevy: una sesión sin registrar no cuenta.'
  ].filter(Boolean).join('\n')

  return `${head}\n\n` + table(
    ['ejercicio', 'series', 'reps', 'RIR', 'carga sugerida_kg', 'base de la sugerencia'],
    next.exercises.map((e: any) => [
      e.name,
      e.target_sets,
      e.rep_min && e.rep_max ? (e.rep_min === e.rep_max ? `${e.rep_min}` : `${e.rep_min}-${e.rep_max}`) : null,
      e.effective_rir ?? null,
      e.suggestion?.weight_kg != null ? num(e.suggestion.weight_kg) : null,
      e.suggestion?.basis ?? null
    ])
  )
}

const getMesocycleEvaluations: ToolFn = async (userId, args) => {
  const meso = await resolveMesocycle(userId, args.mesocycle_id)
  if (!meso) return 'No hay mesociclo activo. Pasa mesocycle_id explícitamente.'

  const evaluations = await prisma.mesocycleEvaluation.findMany({
    where: { mesocycle_id: meso.id },
    orderBy: { week_number: 'asc' },
    select: { week_number: true, evaluation_date: true, summary: true, volume_trend: true, progress_score: true, recommendations: true }
  })
  const head = `EVALUACIONES · ${meso.name} (${meso.status}) · ${fmtDate(meso.start_date)} → ${meso.end_date ? fmtDate(meso.end_date) : 'en curso'}`
  if (!evaluations.length) return `${head}\nSin evaluaciones semanales registradas.`

  return `${head}\n` + evaluations.map(e => [
    `semana ${e.week_number} (${fmtDate(e.evaluation_date)})${e.volume_trend ? ` · volumen ${e.volume_trend}` : ''}${e.progress_score != null ? ` · progreso ${e.progress_score}` : ''}`,
    e.summary ? `  ${e.summary}` : null,
    e.recommendations ? `  recomendaciones: ${e.recommendations}` : null
  ].filter(Boolean).join('\n')).join('\n')
}

const getPreviousMesocycles: ToolFn = async (userId, args) => {
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20)
  const mesos = await prisma.mesocycle.findMany({
    where: { user_id: userId, status: { in: ['completed', 'paused'] } },
    orderBy: { end_date: 'desc' },
    take: limit,
    select: {
      id: true, name: true, goal: true, split_description: true, target_sessions_weekly: true,
      status: true, start_date: true, end_date: true, final_summary: true
    }
  })
  if (!mesos.length) return 'Sin mesociclos completados ni pausados.'

  return `MESOCICLOS ANTERIORES (${mesos.length})\n` + mesos.map(m => [
    `### ${m.name} · ${m.status} · ${fmtDate(m.start_date)} → ${m.end_date ? fmtDate(m.end_date) : NONE} · id ${m.id}`,
    m.goal ? `objetivo: ${m.goal}` : null,
    m.target_sessions_weekly != null ? `sesiones/semana: ${m.target_sessions_weekly}` : null,
    m.split_description ? `split:\n${m.split_description}` : null,
    m.final_summary ? `resumen final:\n${m.final_summary}` : null
  ].filter(Boolean).join('\n')).join('\n\n')
}

// ── Body ───────────────────────────────────────────────────────────────────────

const BODY_COLUMNS: Array<[string, string]> = [
  ['weight', 'peso_kg'], ['body_fat_percentage', 'grasa%'], ['lean_mass', 'magra_kg'],
  ['neck', 'cuello'], ['shoulder', 'hombros'], ['chest', 'pecho'], ['waist', 'cintura'],
  ['abdomen', 'abdomen'], ['hips', 'caderas'],
  ['left_bicep', 'bíceps_i'], ['right_bicep', 'bíceps_d'],
  ['left_bicep_relaxed', 'bíceps_i_rel'], ['right_bicep_relaxed', 'bíceps_d_rel'],
  ['left_forearm', 'antebrazo_i'], ['right_forearm', 'antebrazo_d'],
  ['left_thigh', 'muslo_i'], ['right_thigh', 'muslo_d'],
  ['left_calf', 'gemelo_i'], ['right_calf', 'gemelo_d'],
  ['hrv', 'HRV'], ['resting_hr', 'FC_reposo']
]

const getBodyMetricsRange: ToolFn = async (userId, args) => {
  const start = parseDate(args.start_date, daysAgo(90))!
  const end = parseDate(args.end_date, new Date())!
  const metrics = await prisma.bodyMetric.findMany({
    where: { user_id: userId, date: { gte: start, lte: end } },
    orderBy: { date: 'asc' }
  })
  if (!metrics.length) return `Sin métricas corporales entre ${fmtDate(start)} y ${fmtDate(end)}.`

  // Columns with no data across the whole range are dropped by `table`, so a
  // user who only weighs himself gets two columns, not twenty-one.
  return `MÉTRICAS CORPORALES ${fmtDate(start)} → ${fmtDate(end)} · ${metrics.length} registros\n` + table(
    ['fecha', ...BODY_COLUMNS.map(([, label]) => label)],
    metrics.map(m => [
      fmtDate(m.date),
      ...BODY_COLUMNS.map(([key]) => {
        const value = (m as any)[key]
        return value == null ? null : num(Number(value))
      })
    ])
  )
}

// ── Nutrition ──────────────────────────────────────────────────────────────────

/**
 * Maps the diet serializer's output onto the shape `serializeNutrition`
 * renders, so the diet reads identically whether it arrives in the system
 * prompt or through this tool. Two renderers would eventually disagree, and the
 * model would have no way to tell which set of figures to trust.
 */
function toNutritionSnapshot(diet: any, planName: string, goal?: string | null): NutritionSnapshot {
  const { daily_totals, version_number, from, ...rest } = diet
  const { kcal, protein_g, carbs_g, fat_g, ...micronutrients } = daily_totals ?? {}
  return {
    plan_name: planName,
    ...(goal && { goal }),
    version_number,
    ...(from && { in_force_since: from }),
    daily_kcal: kcal ?? null,
    daily_protein_g: protein_g ?? null,
    daily_carbs_g: carbs_g ?? null,
    daily_fat_g: fat_g ?? null,
    ...(Object.keys(micronutrients).length > 0 && { micronutrients }),
    ...rest
  } as NutritionSnapshot
}

const getDiet: ToolFn = async (userId, args) => {
  // `resolveVersion` checks ownership on `version_id` itself (requireOwnedVersion)
  // and resolves everything else through this user's own active plan.
  const version = await resolveVersion(userId, {
    version_id: args.version_id || null,
    date: args.date || null
  })
  if (!version) {
    return args.date
      ? `No hay ninguna dieta registrada que estuviera vigente el ${args.date}.`
      : 'El usuario no tiene ninguna dieta publicada.'
  }

  const [plan, latestWeight] = await Promise.all([
    prisma.dietPlan.findUnique({ where: { id: version.diet_plan_id } }),
    prisma.bodyMetric.findFirst({
      where: { user_id: userId, weight: { not: null } },
      orderBy: { date: 'desc' },
      select: { weight: true }
    })
  ])

  const diet = serializeDietForAi(version, {
    weightKg: latestWeight?.weight ?? null,
    // The model asked for the diet, so it gets every distinct day in full.
    detail: 'full'
  })

  const header = args.date
    ? `DIETA vigente el ${args.date}${weekdayNameOf(args.date) ? ` (${weekdayNameOf(args.date)})` : ''}`
    : 'DIETA VIGENTE'

  return `${header}\n${serializeNutrition(toNutritionSnapshot(diet, plan?.name ?? 'Sin nombre', plan?.goal))}`
}

const getDietHistory: ToolFn = async (userId, args) => {
  const plan = await getActivePlan(userId)
  if (!plan) return 'El usuario no tiene ninguna dieta registrada.'

  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), MAX_DIET_VERSIONS)
  const versions = await prisma.dietVersion.findMany({
    // Drafts are excluded: they were never followed, so they are not history.
    where: { diet_plan_id: plan.id, status: { in: ['active', 'superseded'] }, start_date: { not: null } },
    orderBy: { start_date: 'desc' },
    take: limit,
    select: {
      id: true, version_number: true, status: true, start_date: true, end_date: true,
      change_note: true, total_kcal: true, total_protein_g: true, total_carbs_g: true, total_fat_g: true
    }
  })
  if (!versions.length) return 'La dieta no tiene versiones publicadas todavía.'

  return `HISTORIAL DE DIETA · ${plan.name}${plan.goal ? ` (objetivo: ${plan.goal})` : ''}\n` +
    'Es un PLAN, no un registro de ingesta. Cifras = media de un día planificado.\n' +
    table(
      ['versión', 'id', 'estado', 'desde', 'hasta', 'kcal', 'P_g', 'C_g', 'G_g', 'nota de cambio'],
      versions.map(v => [
        v.version_number, v.id, v.status, toDateKey(v.start_date), toDateKey(v.end_date) ?? 'vigente',
        int(v.total_kcal), int(v.total_protein_g), int(v.total_carbs_g), int(v.total_fat_g), v.change_note ?? null
      ])
    )
}

const searchFoods: ToolFn = async (userId, args) => {
  const query = (args.query || '').toString().trim()
  if (!query) return fail('query es requerido')
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), MAX_FOOD_RESULTS)

  const foods = await prisma.food.findMany({
    where: { user_id: userId, OR: [{ name: { contains: query } }, { brand: { contains: query } }] },
    orderBy: { name: 'asc' },
    take: limit
  })
  if (!foods.length) return `Sin alimentos que coincidan con "${query}" en el catálogo del usuario.`

  return `ALIMENTOS "${query}" (${foods.length}) · valores POR 100 g\n` + table(
    ['alimento', 'marca', ...NUTRIENT_KEYS],
    foods.map(food => [
      food.name,
      food.brand ?? null,
      ...NUTRIENT_KEYS.map(key => {
        const value = (food as any)[key]
        return value == null ? null : num(Number(value), 2)
      })
    ])
  )
}

// ── Memory ─────────────────────────────────────────────────────────────────────

/** Notes shorter than this are almost never worth remembering on their own. */
const MIN_NOTE_CHARS = 8
const MAX_NOTE_CHARS = 300
/** Word overlap above which two notes are treated as the same note. */
const NOTE_DUPLICATE_RATIO = 0.75

const noteWords = (text: string): Set<string> =>
  new Set(normalizeExerciseName(text).replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(w => w.length > 2))

/** Jaccard-ish overlap: shared words over the size of the smaller note. */
function noteSimilarity(a: string, b: string): number {
  const wa = noteWords(a)
  const wb = noteWords(b)
  if (!wa.size || !wb.size) return 0
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared++
  return shared / Math.min(wa.size, wb.size)
}

/**
 * Persists something the athlete said about themselves.
 *
 * This is the one tool that writes, and it writes into every future
 * conversation's system prompt — a bad note is not a bad answer, it is a bad
 * answer repeated indefinitely. Hence:
 *
 *  - **Deduplicated.** The model re-derives the same fact from the same message
 *    on later turns ("viaja a Londres en mayo") and each save used to append
 *    another row, so the prompt accumulated the same sentence five times. A
 *    near-identical active note is returned instead of a second row.
 *  - **Bounded**, in length and in count, because the notes block is permanent
 *    context and has no other ceiling.
 *  - **The prompt requires it to come from the user's own words.** Nothing here
 *    can verify that, which is exactly why the instruction is explicit both in
 *    the tool description and in the chat prompt: an inference the model liked
 *    is not something the athlete told it.
 */
const MAX_ACTIVE_NOTES = 40

const saveUserNote: ToolFn = async (userId, args) => {
  const content = (args.content || '').toString().trim().slice(0, MAX_NOTE_CHARS)
  if (content.length < MIN_NOTE_CHARS) {
    return fail('La nota está vacía o es demasiado corta para ser útil más adelante.')
  }

  const existing = await prisma.aiNote.findMany({
    where: { user_id: userId, is_active: true },
    select: { id: true, content: true }
  })

  const duplicate = existing.find(n => noteSimilarity(n.content, content) >= NOTE_DUPLICATE_RATIO)
  if (duplicate) {
    return `Ya existe una nota equivalente, no se ha creado otra: [${duplicate.id}] ${duplicate.content}. Si el dato ha cambiado, desactiva esa y guarda la nueva.`
  }

  if (existing.length >= MAX_ACTIVE_NOTES) {
    return fail(`El usuario ya tiene ${existing.length} notas activas (máximo ${MAX_ACTIVE_NOTES}). Desactiva alguna que ya no aplique antes de guardar otra.`)
  }

  const note = await prisma.aiNote.create({ data: { user_id: userId, content } })
  return `Nota guardada. id: ${note.id}`
}

const deactivateUserNote: ToolFn = async (userId, args) => {
  const noteId = (args.note_id || '').toString()
  if (!noteId) return fail('note_id es requerido')
  // updateMany with the owner in the filter: a note id from another account
  // matches zero rows instead of being deactivated.
  const result = await prisma.aiNote.updateMany({
    where: { id: noteId, user_id: userId },
    data: { is_active: false }
  })
  if (result.count === 0) return fail('Nota no encontrada o no pertenece al usuario')
  return 'Nota desactivada.'
}

// ── Registry ───────────────────────────────────────────────────────────────────

const TOOL_IMPLS: Record<string, ToolFn> = {
  get_workouts_in_range: getWorkoutsInRange,
  get_workout_detail: getWorkoutDetail,
  list_exercises: listExercises,
  get_exercise_progression: getExerciseProgression,
  get_weekly_aggregates: getWeeklyAggregates,
  get_volume_by_muscle_group: getVolumeByMuscleGroup,
  get_training_alerts: getTrainingAlerts,
  get_personal_records: getPersonalRecords,
  get_active_plan: getActivePlanTool,
  get_next_planned_session: getNextPlannedSession,
  get_mesocycle_evaluations: getMesocycleEvaluations,
  get_previous_mesocycles: getPreviousMesocycles,
  get_body_metrics_range: getBodyMetricsRange,
  get_diet: getDiet,
  get_diet_history: getDietHistory,
  search_foods: searchFoods,
  save_user_note: saveUserNote,
  deactivate_user_note: deactivateUserNote
}

/**
 * Provider-neutral tool definitions (plain JSON Schema, no vendor wrapper).
 *
 * Descriptions are the *only* documentation the model gets, so the reading
 * rules that matter live here as well as in the prompt — but only the ones a
 * caller needs to decide whether to call the tool and how to read what comes
 * back. Adding a tool = one entry here, one impl in TOOL_IMPLS, one group below.
 */
export const AI_TOOLS: ToolDefinition[] = [
  {
    name: 'get_workouts_in_range',
    description: `Entrenamientos en un rango de fechas. summary = ejercicios con series y volumen (máx ${MAX_WORKOUTS_SUMMARY} entrenos). full = además todas las series con peso×reps@RPE (máx ${MAX_WORKOUTS_FULL}). Para el detalle de UNA sesión concreta usa get_workout_detail.`,
    parameters: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
        end_date: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
        detail: { type: 'string', enum: ['summary', 'full'], description: 'summary (por defecto) o full' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'get_workout_detail',
    description: 'Detalle completo de un entrenamiento con todas sus series. Pasa workout_id (aparece en get_workouts_in_range) o date (YYYY-MM-DD).',
    parameters: {
      type: 'object',
      properties: {
        workout_id: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' }
      }
    }
  },
  {
    name: 'list_exercises',
    description: 'Ejercicios que el usuario ha registrado, con nº de sesiones, última fecha y mejor 1RM estimado. Úsalo antes de get_exercise_progression cuando no sepas el nombre exacto.',
    parameters: {
      type: 'object',
      properties: { weeks_back: { type: 'number', description: 'Semanas hacia atrás (1-156, default 52)' } }
    }
  },
  {
    name: 'get_exercise_progression',
    description: 'Progresión de UN ejercicio: 1RM estimado, volumen y mejor serie por sesión. Prioriza el nombre exacto; si la palabra coincide con varios ejercicios lo avisa.',
    parameters: {
      type: 'object',
      properties: {
        exercise_name: { type: 'string', description: 'Nombre exacto (preferido) o palabra clave' },
        weeks_back: { type: 'number', description: 'Semanas hacia atrás (1-52, default 12)' }
      },
      required: ['exercise_name']
    }
  },
  {
    name: 'get_weekly_aggregates',
    description: 'Por semana: sesiones, volumen total, RPE medio y desglose de series y volumen por ejercicio. Para tendencias de carga y adherencia global.',
    parameters: {
      type: 'object',
      properties: { weeks_back: { type: 'number', description: 'Semanas hacia atrás (1-26, default 8)' } }
    }
  },
  {
    name: 'get_volume_by_muscle_group',
    description: `Series semanales efectivas por grupo muscular frente a MEV/MAV/MRV. Es LA métrica del reparto de volumen en hipertrofia: el tonelaje sube al añadir un día de pierna y no dice nada del pecho. El movimiento primario cuenta 1 serie y cada secundario 0,5. "verdict" vale below_mev | developmental | optimal | above_mrv. Si la cobertura de clasificación es baja, dilo como limitación de los datos y NO concluyas que el usuario no entrena ese músculo.`,
    parameters: {
      type: 'object',
      properties: { weeks_back: { type: 'number', description: 'Semanas hacia atrás (1-26, default 8)' } }
    }
  },
  {
    name: 'get_training_alerts',
    description: 'Problemas ya detectados por la app tras cada sincronización: estancamiento, fatiga (RPE al alza a carga constante), grupos por debajo del MEV y necesidad de descarga, con los datos que los respaldan. Úsalo AL PRINCIPIO en preguntas abiertas ("¿cómo voy?", "¿debería hacer deload?") en vez de rederivar el diagnóstico.',
    parameters: {
      type: 'object',
      properties: { include_dismissed: { type: 'boolean', description: 'Incluir las descartadas por el usuario (default false)' } }
    }
  },
  {
    name: 'get_personal_records',
    description: 'Récords vigentes (peso máximo, 1RM estimado, volumen en sesión, reps a un peso) con la marca anterior y la fecha. Útil para contrastar una queja de estancamiento con lo que sí ha mejorado.',
    parameters: {
      type: 'object',
      properties: { exercise_name: { type: 'string', description: 'Limitar a un ejercicio (opcional)' } }
    }
  },
  {
    name: 'get_active_plan',
    description: `El plan ESTRUCTURADO del mesociclo: semanas del bloque (RIR objetivo, descarga, multiplicador de volumen), cada sesión con sus ejercicios, series, rango de repeticiones, RIR y descanso, y la adherencia (series hechas frente a prescritas por ejercicio).
Úsalo para cualquier pregunta sobre lo PLANIFICADO: qué ejercicios toca esta semana, cuántas series de un grupo muscular hay prescritas, si está siguiendo el plan, qué se está quedando corto. No deduzcas el plan a partir de los entrenamientos: lo planificado y lo hecho son cosas distintas y esta herramienta las compara.`,
    parameters: {
      type: 'object',
      properties: {
        mesocycle_id: { type: 'string', description: 'Opcional; por defecto el mesociclo activo.' },
        include_adherence: { type: 'boolean', description: 'Incluir la comparación con lo entrenado (default true)' }
      }
    }
  },
  {
    name: 'get_next_planned_session',
    description: 'Qué sesión toca ahora según el plan, con la carga sugerida por ejercicio y por qué se ha elegido esa sesión (día asignado, rotación o inicio de bloque). Úsalo para "¿qué me toca hoy/mañana?". Se basa solo en lo sincronizado desde Hevy.',
    parameters: {
      type: 'object',
      properties: { mesocycle_id: { type: 'string', description: 'Opcional; por defecto el mesociclo activo.' } }
    }
  },
  {
    name: 'get_mesocycle_evaluations',
    description: 'Evaluaciones semanales de un mesociclo (por defecto el activo): resumen, tendencia de volumen y recomendaciones por semana.',
    parameters: {
      type: 'object',
      properties: { mesocycle_id: { type: 'string', description: 'Opcional. Si se omite, el mesociclo activo.' } }
    }
  },
  {
    name: 'get_previous_mesocycles',
    description: 'Mesociclos completados o pausados con su split y su resumen final. Para comparar con bloques anteriores.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Máx mesociclos (1-20, default 5)' } }
    }
  },
  {
    name: 'get_body_metrics_range',
    description: 'Métricas corporales en un rango: peso, % grasa, masa magra, circunferencias (cuello, hombros, pecho, cintura, abdomen, caderas, bíceps, antebrazo, muslo, gemelo), HRV y FC en reposo. Solo aparecen las columnas con datos.',
    parameters: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'get_diet',
    description: `La dieta con su MENÚ: comidas y alimentos con gramos por cada día distinto de la semana, más energía, macros y micronutrientes conocidos.
Sin parámetros devuelve la dieta vigente ahora. "date" devuelve la que estaba vigente esa fecha; "version_id" (de get_diet_history) una versión concreta.
LA DIETA VARÍA POR DÍA DE LA SEMANA: los días idénticos van agrupados. La media de un día planificado no es lo que come un día concreto — para un día concreto mira su grupo.
Es la dieta PLANIFICADA, no un registro de lo que comió. Un micronutriente ausente falta en la base de alimentos, NO es una ingesta de cero.`,
    parameters: {
      type: 'object',
      properties: {
        version_id: { type: 'string', description: 'ID de versión, como aparece en get_diet_history.' },
        date: { type: 'string', description: 'YYYY-MM-DD. Se ignora si se pasa version_id.' }
      }
    }
  },
  {
    name: 'get_diet_history',
    description: `Versiones publicadas de la dieta con fechas, nota de cambio y totales diarios. Para ver cómo ha evolucionado la ingesta planificada y correlacionarla con el peso. Para el menú de una versión, llama después a get_diet con su version_id. Máx ${MAX_DIET_VERSIONS} versiones.`,
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: `Versiones más recientes (1-${MAX_DIET_VERSIONS}, default 10)` } }
    }
  },
  {
    name: 'search_foods',
    description: `Busca en el catálogo de alimentos del usuario por nombre o marca; valores POR 100 g. Solo el catálogo guardado, no bases externas. Máx ${MAX_FOOD_RESULTS} resultados.`,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto en el nombre o la marca. Ej: "pollo", "avena".' },
        limit: { type: 'number', description: `Máximo de resultados (1-${MAX_FOOD_RESULTS}, default 10)` }
      },
      required: ['query']
    }
  },
  {
    name: 'save_user_note',
    description: `Guarda una nota persistente sobre el usuario que se recordará en futuras conversaciones.
SOLO para lo que el usuario ha dicho EXPLÍCITAMENTE en su mensaje: preferencias, equipamiento disponible, contexto temporal (viaje, lesión reciente, época de estrés), objetivos concretos con fecha, restricciones nuevas. Guárdalo en el mismo turno en que lo menciona.
NO la uses para: conclusiones o inferencias tuyas a partir de sus datos, cifras que ya están en la base de datos (peso, volumen, récords), información de un turno anterior que ya guardaste, ni datos sensibles que no hagan falta para entrenar.
Si ya existe una nota equivalente, la herramienta te lo dirá y no creará otra: no insistas reformulándola.`,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Nota concisa en tercera persona, con fecha si es relevante. Ej: "Viaja a Londres del 20 al 30 de mayo, sin acceso a gimnasio." Máx 300 caracteres.'
        }
      },
      required: ['content']
    }
  },
  {
    name: 'deactivate_user_note',
    description: `Marca una nota como inactiva cuando el usuario indica que la situación cambió o se resolvió, cuando su fecha límite ya pasó (compara con HOY), o cuando la contradice. Si hay duda, no la desactives.`,
    parameters: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: 'ID de la nota, tal como aparece entre corchetes en NOTAS RECORDADAS: [uuid]' }
      },
      required: ['note_id']
    }
  }
]

const TOOLS_BY_NAME = new Map(AI_TOOLS.map(t => [t.name, t]))

/**
 * Tools grouped by the question they answer.
 *
 * `memory` travels with every turn: it is two small definitions, and the moment
 * the athlete mentions a trip or a niggle is the moment it has to be saved —
 * that can happen in the middle of a question about anything.
 */
export const TOOL_GROUPS = {
  training: [
    'get_workouts_in_range', 'get_workout_detail', 'list_exercises', 'get_exercise_progression',
    'get_weekly_aggregates', 'get_volume_by_muscle_group', 'get_training_alerts', 'get_personal_records'
  ],
  plan: ['get_active_plan', 'get_next_planned_session', 'get_mesocycle_evaluations', 'get_previous_mesocycles'],
  body: ['get_body_metrics_range'],
  nutrition: ['get_diet', 'get_diet_history', 'search_foods'],
  memory: ['save_user_note', 'deactivate_user_note']
} as const

export type ToolDomain = keyof typeof TOOL_GROUPS

/**
 * Words that put a question unambiguously in one domain. Deliberately short and
 * literal — this is a filter, not an intent classifier, and anything it isn't
 * sure about falls through to "send everything".
 */
const DOMAIN_KEYWORDS: Record<Exclude<ToolDomain, 'memory'>, string[]> = {
  training: [
    'entren', 'serie', 'repetic', 'reps', 'rpe', 'rir', 'volumen', 'carga', 'peso levant',
    'press', 'sentadilla', 'dominad', 'curl', 'remo', 'banca', 'ejercicio', '1rm', 'rm',
    'fallo', 'descarga', 'deload', 'estanc', 'progres', 'fatiga', 'record', 'récord', 'pr ',
    'pecho', 'espalda', 'pierna', 'biceps', 'bíceps', 'triceps', 'tríceps', 'hombro', 'gluteo', 'glúteo'
  ],
  plan: [
    'plan', 'planific', 'rutina', 'mesociclo', 'bloque', 'me toca', 'toca hoy', 'toca mañana',
    'siguiente sesion', 'siguiente sesión', 'próxima sesión', 'proxima sesion', 'split',
    'adherencia', 'prescrit', 'programad', 'semana del bloque'
  ],
  body: [
    'peso corporal', 'kilos', 'báscula', 'bascula', 'grasa', 'masa magra', 'medida', 'cintura',
    'perímetro', 'perimetro', 'hrv', 'pulsaciones', 'frecuencia cardiaca', 'frecuencia cardíaca', 'composición corporal'
  ],
  nutrition: [
    'dieta', 'comida', 'comer', 'aliment', 'kcal', 'caloria', 'caloría', 'macro', 'proteina',
    'proteína', 'carbohidrat', 'hidrato', 'grasa saturada', 'desayun', 'almuerz', 'cena', 'merienda',
    'suplement', 'creatina', 'nutricion', 'nutrición', 'déficit', 'deficit', 'superávit', 'superavit'
  ]
}

/** Domains a message clearly belongs to. Empty = unclear, which is not an error. */
export function matchToolDomains(message: string): ToolDomain[] {
  const text = message.toLowerCase()
  return (Object.keys(DOMAIN_KEYWORDS) as Array<Exclude<ToolDomain, 'memory'>>)
    .filter(domain => DOMAIN_KEYWORDS[domain].some(keyword => text.includes(keyword)))
}

const toolsOf = (names: readonly string[]): ToolDefinition[] =>
  names.map(n => TOOLS_BY_NAME.get(n)).filter(Boolean) as ToolDefinition[]

/**
 * The tools offered for one chat turn.
 *
 * The whole catalogue is ~2.5k tokens of definitions, re-sent on every round of
 * the turn, and a question about breakfast has no use for eight training tools.
 * So: **a question that lands in exactly one domain gets that domain (plus
 * memory); anything else gets everything.**
 *
 * The bias towards "everything" is deliberate and is the safety property here.
 * A tool the model cannot see is a question it answers worse, silently, and
 * open-ended coaching questions ("¿cómo voy?") are precisely the ones that
 * legitimately span training, plan and diet — so they keep the full set. The
 * saving comes from the narrow, frequent questions, which are the majority.
 *
 * Selected once per turn from the incoming message and held constant across the
 * turn's tool rounds: a set that changed mid-turn would invalidate the cached
 * prefix on every round, which costs more than the definitions it removes.
 */
export function selectChatTools(message: string): ToolDefinition[] {
  const domains = matchToolDomains(message)
  if (domains.length !== 1) return AI_TOOLS
  return toolsOf([...TOOL_GROUPS[domains[0]], ...TOOL_GROUPS.memory])
}

export async function executeTool(name: string, userId: string, args: any): Promise<string> {
  const impl = TOOL_IMPLS[name]
  if (!impl) return fail(`La herramienta "${name}" no existe`)
  try {
    return await impl(userId, args || {})
  } catch (err: any) {
    // Surfaced to the model rather than thrown: it can retry with different
    // arguments, where a thrown error loses the whole turn.
    return fail(`fallo ejecutando ${name}: ${err?.message || 'desconocido'}`)
  }
}
