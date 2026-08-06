import { prisma } from './prisma'
import type { ToolDefinition } from './ai-provider'

type ToolFn = (userId: string, args: any) => Promise<any>

// Caps to keep tool outputs from flooding the model context.
const MAX_WORKOUTS_SUMMARY = 40
const MAX_WORKOUTS_FULL = 12

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

const n1 = (v: any): number | null => v != null ? parseFloat(parseFloat(v).toFixed(1)) : null

const summarizeWorkout = (w: any) => {
  const exSummary: any[] = w.exercises_summary ? JSON.parse(w.exercises_summary) : []
  const result: any = {
    id: w.id,
    date: fmtDate(w.date),
    name: w.name,
    total_volume_kg: w.total_volume ? Math.round(Number(w.total_volume)) : null,
    rpe_avg: w.rpe_avg ? Number(w.rpe_avg) : null,
  }
  if (w.notes) result.notes = w.notes
  if (exSummary.length) {
    result.exercises = exSummary.map((ex: any) => {
      const e: any = { name: ex.name, sets: ex.sets }
      if (ex.total_volume) e.volume_kg = Math.round(Number(ex.total_volume))
      if (ex.estimated_1rm && ex.type !== 'cardio' && ex.type !== 'duration') {
        e.estimated_1rm_kg = parseFloat(parseFloat(ex.estimated_1rm).toFixed(1))
      }
      return e
    })
  }
  return result
}

const fullWorkout = (w: any) => {
  const exSummary: any[] = w.exercises_summary ? JSON.parse(w.exercises_summary) : []
  return {
    id: w.id,
    date: fmtDate(w.date),
    name: w.name,
    total_volume_kg: w.total_volume ? Math.round(Number(w.total_volume)) : null,
    rpe_avg: w.rpe_avg ? Number(w.rpe_avg) : null,
    ...(w.notes && { notes: w.notes }),
    exercises: exSummary.map((ex: any) => {
      const e: any = {
        name: ex.name,
        sets: ex.sets,
        total_volume_kg: ex.total_volume ? Math.round(Number(ex.total_volume)) : null,
      }
      if (ex.estimated_1rm) e.estimated_1rm_kg = parseFloat(parseFloat(ex.estimated_1rm).toFixed(1))
      if (ex.total_distance_meters) e.total_distance_m = ex.total_distance_meters
      if (ex.total_duration_seconds) e.total_duration_s = ex.total_duration_seconds
      e.sets_details = (ex.sets_details || []).map((s: any) => {
        const sd: any = {}
        if (s.weight != null) sd.weight_kg = s.weight
        if (s.reps != null) sd.reps = s.reps
        if (s.rpe) sd.rpe = s.rpe
        if (s.duration_seconds) sd.duration_s = s.duration_seconds
        if (s.distance_meters) sd.distance_m = s.distance_meters
        return sd
      })
      return e
    })
  }
}

const getWorkoutsInRange: ToolFn = async (userId, args) => {
  const start = parseDate(args.start_date, daysAgo(14))!
  const end = parseDate(args.end_date, new Date())!
  const detail = args.detail === 'full' ? 'full' : 'summary'
  const cap = detail === 'full' ? MAX_WORKOUTS_FULL : MAX_WORKOUTS_SUMMARY
  const workouts = await prisma.workout.findMany({
    where: { user_id: userId, date: { gte: start, lte: end } },
    orderBy: { date: 'desc' },
    take: cap + 1,
    select: { id: true, name: true, date: true, total_volume: true, rpe_avg: true, notes: true, exercises_summary: true }
  })
  const truncated = workouts.length > cap
  const visible = workouts.slice(0, cap).reverse()
  return {
    range: { start: fmtDate(start), end: fmtDate(end) },
    count: visible.length,
    ...(truncated && {
      truncated: true,
      note: `Se muestran solo los ${cap} entrenamientos más recientes del rango. Pide un rango más corto${detail === 'full' ? ' o usa detail=summary' : ''} para ver el resto.`
    }),
    workouts: visible.map(detail === 'full' ? fullWorkout : summarizeWorkout)
  }
}

const getWorkoutDetail: ToolFn = async (userId, args) => {
  if (!args.workout_id && !args.date) {
    return { error: 'workout_id o date es requerido' }
  }
  const where: any = { user_id: userId }
  if (args.workout_id) where.id = args.workout_id
  if (args.date) {
    const day = parseDate(args.date)!
    const next = new Date(day); next.setDate(next.getDate() + 1)
    where.date = { gte: day, lt: next }
  }
  const w = await prisma.workout.findFirst({ where, orderBy: { date: 'desc' } })
  if (!w) return { error: 'Entrenamiento no encontrado' }
  return fullWorkout(w)
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
  return {
    total: map.size,
    exercises: Array.from(map.entries())
      .sort((a, b) => b[1].sessions - a[1].sessions)
      .map(([name, s]) => {
        const e: any = { name, type: s.type, sessions: s.sessions, last_date: s.last_date }
        if (s.best_1rm != null) e.best_1rm_kg = parseFloat(s.best_1rm.toFixed(1))
        return e
      })
  }
}

const getExerciseProgression: ToolFn = async (userId, args) => {
  const name = (args.exercise_name || '').toLowerCase()
  if (!name) return { error: 'exercise_name es requerido' }
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

  const hasExact = parsed.some(w => w.exs.some(e => (e.name as string).toLowerCase() === name))
  const matchedNames = new Set<string>()
  const sessions: any[] = []
  for (const w of parsed) {
    const match = hasExact
      ? w.exs.find(e => (e.name as string).toLowerCase() === name)
      : w.exs.find(e => (e.name as string).toLowerCase().includes(name))
    if (!match) continue
    matchedNames.add(match.name)
    sessions.push({
      date: fmtDate(w.date),
      sets: match.sets,
      total_volume_kg: match.total_volume ? Math.round(Number(match.total_volume)) : null,
      estimated_1rm_kg: match.estimated_1rm ? parseFloat(parseFloat(match.estimated_1rm).toFixed(1)) : null,
      top_set: (() => {
        const details = match.sets_details || []
        if (!details.length) return null
        const best = details.reduce((a: any, b: any) => {
          const va = (a?.weight ?? 0) * (a?.reps ?? 0)
          const vb = (b?.weight ?? 0) * (b?.reps ?? 0)
          return vb > va ? b : a
        })
        const ts: any = {}
        if (best.weight != null) ts.weight_kg = best.weight
        if (best.reps != null) ts.reps = best.reps
        if (best.rpe) ts.rpe = best.rpe
        return ts
      })()
    })
  }
  return {
    exercise_query: args.exercise_name,
    matched_exercises: Array.from(matchedNames),
    ...(matchedNames.size > 1 && {
      warning: 'La búsqueda coincide con varios ejercicios distintos y las sesiones están mezcladas. Usa list_exercises y repite con el nombre exacto.'
    }),
    weeks_back: weeksBack,
    sessions_found: sessions.length,
    sessions
  }
}

const getBodyMetricsRange: ToolFn = async (userId, args) => {
  const start = parseDate(args.start_date, daysAgo(90))!
  const end = parseDate(args.end_date, new Date())!
  const metrics = await prisma.bodyMetric.findMany({
    where: { user_id: userId, date: { gte: start, lte: end } },
    orderBy: { date: 'asc' },
    select: {
      date: true, weight: true, body_fat_percentage: true, lean_mass: true,
      neck: true, shoulder: true, chest: true, waist: true, abdomen: true, hips: true,
      left_bicep: true, right_bicep: true, left_bicep_relaxed: true, right_bicep_relaxed: true,
      left_forearm: true, right_forearm: true,
      left_thigh: true, right_thigh: true,
      left_calf: true, right_calf: true,
      hrv: true, resting_hr: true
    }
  })
  return {
    range: { start: fmtDate(start), end: fmtDate(end) },
    count: metrics.length,
    metrics: metrics.map(m => {
      const entry: any = { date: fmtDate(m.date) }
      if (m.weight != null) entry.weight_kg = n1(m.weight)
      if (m.body_fat_percentage != null) entry.body_fat_pct = n1(m.body_fat_percentage)
      if (m.lean_mass != null) entry.lean_mass_kg = n1(m.lean_mass)
      if (m.neck != null) entry.neck_cm = n1(m.neck)
      if (m.shoulder != null) entry.shoulder_cm = n1(m.shoulder)
      if (m.chest != null) entry.chest_cm = n1(m.chest)
      if (m.waist != null) entry.waist_cm = n1(m.waist)
      if (m.abdomen != null) entry.abdomen_cm = n1(m.abdomen)
      if (m.hips != null) entry.hips_cm = n1(m.hips)
      if (m.left_bicep != null) entry.left_bicep_cm = n1(m.left_bicep)
      if (m.right_bicep != null) entry.right_bicep_cm = n1(m.right_bicep)
      if (m.left_bicep_relaxed != null) entry.left_bicep_relaxed_cm = n1(m.left_bicep_relaxed)
      if (m.right_bicep_relaxed != null) entry.right_bicep_relaxed_cm = n1(m.right_bicep_relaxed)
      if (m.left_forearm != null) entry.left_forearm_cm = n1(m.left_forearm)
      if (m.right_forearm != null) entry.right_forearm_cm = n1(m.right_forearm)
      if (m.left_thigh != null) entry.left_thigh_cm = n1(m.left_thigh)
      if (m.right_thigh != null) entry.right_thigh_cm = n1(m.right_thigh)
      if (m.left_calf != null) entry.left_calf_cm = n1(m.left_calf)
      if (m.right_calf != null) entry.right_calf_cm = n1(m.right_calf)
      if (m.hrv != null) entry.hrv = n1(m.hrv)
      if (m.resting_hr != null) entry.resting_hr = Number(m.resting_hr)
      return entry
    })
  }
}

const getMesocycleEvaluations: ToolFn = async (userId, args) => {
  let mesoId: string | undefined = args.mesocycle_id
  if (!mesoId) {
    const active = await prisma.mesocycle.findFirst({ where: { user_id: userId, status: 'active' } })
    if (!active) return { error: 'No hay mesociclo activo. Pasa mesocycle_id explícitamente.' }
    mesoId = active.id
  }
  const meso = await prisma.mesocycle.findFirst({
    where: { id: mesoId, user_id: userId },
    select: {
      id: true, name: true, goal: true, status: true, start_date: true, end_date: true,
      evaluations: {
        orderBy: { week_number: 'asc' },
        select: { week_number: true, evaluation_date: true, summary: true, volume_trend: true, progress_score: true, recommendations: true }
      }
    }
  })
  if (!meso) return { error: 'Mesociclo no encontrado' }
  return {
    mesocycle: {
      id: meso.id, name: meso.name, goal: meso.goal, status: meso.status,
      start: fmtDate(meso.start_date), end: meso.end_date ? fmtDate(meso.end_date) : null
    },
    evaluations: meso.evaluations.map(e => ({
      week: e.week_number,
      date: fmtDate(e.evaluation_date),
      summary: e.summary,
      volume_trend: e.volume_trend,
      progress_score: e.progress_score,
      recommendations: e.recommendations
    }))
  }
}

const getPreviousMesocycles: ToolFn = async (userId, args) => {
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20)
  const mesos = await prisma.mesocycle.findMany({
    where: { user_id: userId, status: { in: ['completed', 'paused'] } },
    orderBy: { end_date: 'desc' },
    take: limit,
    select: {
      id: true, name: true, goal: true, split_description: true, target_volume_weekly: true,
      status: true, start_date: true, end_date: true, final_summary: true
    }
  })
  return {
    count: mesos.length,
    mesocycles: mesos.map(m => ({
      id: m.id,
      name: m.name,
      goal: m.goal,
      split: m.split_description,
      target_sessions_weekly: m.target_volume_weekly,
      status: m.status,
      start: fmtDate(m.start_date),
      end: m.end_date ? fmtDate(m.end_date) : null,
      ...(m.final_summary && { final_summary: m.final_summary })
    }))
  }
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
    const d = new Date(w.date)
    const day = d.getDay()
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
    d.setHours(0, 0, 0, 0)
    const key = d.toISOString().substring(0, 10)
    if (!byWeek.has(key)) byWeek.set(key, { volumes: [], rpes: [], count: 0, exercises: new Map() })
    const bucket = byWeek.get(key)!
    bucket.count++
    if (w.total_volume) bucket.volumes.push(Number(w.total_volume))
    if (w.rpe_avg) bucket.rpes.push(Number(w.rpe_avg))
    if (w.exercises_summary) {
      let exs: any[]
      try { exs = JSON.parse(w.exercises_summary) } catch { continue }
      for (const ex of exs) {
        if (!bucket.exercises.has(ex.name)) bucket.exercises.set(ex.name, { sets: 0, volume: 0 })
        const e = bucket.exercises.get(ex.name)!
        e.sets += ex.sets ?? 0
        e.volume += ex.total_volume ? Math.round(Number(ex.total_volume)) : 0
      }
    }
  }
  return {
    weeks_back: weeksBack,
    weeks: Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStart, b]) => ({
        week_start: weekStart,
        sessions: b.count,
        total_volume_kg: b.volumes.length ? Math.round(b.volumes.reduce((s, v) => s + v, 0)) : 0,
        avg_rpe: b.rpes.length ? parseFloat((b.rpes.reduce((s, v) => s + v, 0) / b.rpes.length).toFixed(2)) : null,
        exercises: Array.from(b.exercises.entries())
          .sort((a, b) => b[1].volume - a[1].volume)
          .map(([name, s]) => ({ name, sets: s.sets, volume_kg: s.volume }))
      }))
  }
}

const saveUserNote: ToolFn = async (userId, args) => {
  const content = (args.content || '').toString().slice(0, 300)
  if (!content.trim()) return { error: 'El contenido de la nota no puede estar vacío' }
  const note = await prisma.aiNote.create({ data: { user_id: userId, content } })
  return { success: true, note_id: note.id, message: 'Nota guardada correctamente.' }
}

const deactivateUserNote: ToolFn = async (userId, args) => {
  const noteId = (args.note_id || '').toString()
  if (!noteId) return { error: 'note_id es requerido' }
  const result = await prisma.aiNote.updateMany({
    where: { id: noteId, user_id: userId },
    data: { is_active: false }
  })
  if (result.count === 0) return { error: 'Nota no encontrada o no pertenece al usuario' }
  return { success: true, message: 'Nota desactivada.' }
}

const TOOL_IMPLS: Record<string, ToolFn> = {
  get_workouts_in_range: getWorkoutsInRange,
  get_workout_detail: getWorkoutDetail,
  list_exercises: listExercises,
  get_exercise_progression: getExerciseProgression,
  get_body_metrics_range: getBodyMetricsRange,
  get_mesocycle_evaluations: getMesocycleEvaluations,
  get_previous_mesocycles: getPreviousMesocycles,
  get_weekly_aggregates: getWeeklyAggregates,
  save_user_note: saveUserNote,
  deactivate_user_note: deactivateUserNote
}

/**
 * Provider-neutral tool definitions (plain JSON Schema, no vendor wrapper).
 * The provider adapter translates these to the vendor's tool format.
 * Adding a tool = one entry here + one impl in TOOL_IMPLS.
 */
export const AI_TOOLS: ToolDefinition[] = [
  {
    name: 'get_workouts_in_range',
    description: `Obtiene entrenamientos en un rango de fechas. Summary incluye nombre de ejercicios, series y volumen por ejercicio (máx ${MAX_WORKOUTS_SUMMARY} entrenos). Full añade todas las series con peso/reps/RPE (máx ${MAX_WORKOUTS_FULL} entrenos; para más, usa rangos cortos). Úsalo para revisar semanas concretas, comparar periodos o ver qué ejercicios se hicieron.`,
    parameters: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
        end_date: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
        detail: { type: 'string', enum: ['summary', 'full'], description: 'summary = fecha/nombre/volumen/RPE + ejercicios con series y volumen. full = todas las series con peso/reps/RPE. Usa full solo si necesitas series detalladas.' }
      },
      required: ['start_date', 'end_date']
    }
  },
  {
    name: 'get_workout_detail',
    description: 'Detalle completo de un entrenamiento concreto con todas sus series. Usa workout_id si lo tienes (viene en get_workouts_in_range), si no pasa date (YYYY-MM-DD).',
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
    description: 'Lista todos los ejercicios registrados con nº de sesiones, última fecha y mejor 1RM estimado. Úsalo antes de get_exercise_progression cuando no sepas el nombre exacto del ejercicio, o cuando el usuario pregunte qué ejercicios hace habitualmente.',
    parameters: {
      type: 'object',
      properties: {
        weeks_back: { type: 'number', description: 'Semanas hacia atrás a considerar (1-156, default 52)' }
      }
    }
  },
  {
    name: 'get_exercise_progression',
    description: 'Progresión histórica de UN ejercicio concreto: 1RM estimado, volumen total y mejor serie por sesión. Útil para analizar estancamientos o progreso en movimientos específicos. Prioriza coincidencias exactas de nombre; si tu keyword coincide con varios ejercicios, devuelve un aviso — usa list_exercises para obtener el nombre exacto.',
    parameters: {
      type: 'object',
      properties: {
        exercise_name: { type: 'string', description: 'Nombre exacto del ejercicio (preferido) o palabra clave (ej: "press banca", "squat")' },
        weeks_back: { type: 'number', description: 'Semanas hacia atrás (1-52, default 12)' }
      },
      required: ['exercise_name']
    }
  },
  {
    name: 'get_body_metrics_range',
    description: 'Métricas corporales en un rango de fechas: peso, % grasa, masa magra y todas las medidas de circunferencia (cuello, hombros, pecho, cintura, abdomen, caderas, bíceps izq/der flexionado/relajado, antebrazo, muslo, gemelo) más HRV y FC en reposo. Solo incluye los campos que tienen datos registrados.',
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
    name: 'get_mesocycle_evaluations',
    description: 'Evaluaciones semanales de un mesociclo (por defecto el activo). Devuelve resumen, tendencia de volumen y recomendaciones por semana.',
    parameters: {
      type: 'object',
      properties: {
        mesocycle_id: { type: 'string', description: 'Opcional. Si se omite, usa el mesociclo activo.' }
      }
    }
  },
  {
    name: 'get_previous_mesocycles',
    description: 'Lista mesociclos completados o pausados con su resumen final. Úsalo cuando el usuario pregunte por bloques anteriores o quiera comparar con el pasado.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Máx mesociclos a devolver (1-20, default 5)' }
      }
    }
  },
  {
    name: 'get_weekly_aggregates',
    description: 'Agregados semanales: sesiones, volumen total, RPE medio y desglose de volumen y series por ejercicio. Útil para ver tendencias de carga, adherencia o qué ejercicios acumulan más volumen.',
    parameters: {
      type: 'object',
      properties: {
        weeks_back: { type: 'number', description: 'Semanas hacia atrás (1-26, default 8)' }
      }
    }
  },
  {
    name: 'save_user_note',
    description: `Guarda una nota persistente sobre el usuario que se recordará en futuras conversaciones.
CUÁNDO USARLA: cuando el usuario mencione algo que no está en su perfil y sea útil recordar más adelante:
- Preferencias: ejercicios que le gustan/no gustan, equipamiento disponible, horarios de entrenamiento
- Contexto temporal: viaje próximo, evento social, época de estrés laboral, vacaciones
- Objetivos personales: competición, fecha objetivo, motivación concreta
- Contexto nutricional: corte/volumen, dieta especial, cambio de calorías
- Restricciones nuevas no formalizadas en el perfil: molestia reciente, limitación temporal
NO USARLA para: información ya en el perfil (peso, altura, lesiones_notas), preguntas puntuales, saludos o charla casual.`,
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Nota concisa en tercera persona. Incluye fecha si es relevante. Ej: "Tiene viaje a Londres del 20 al 30 de mayo, sin acceso a gimnasio." Máximo 300 caracteres.'
        }
      },
      required: ['content']
    }
  },
  {
    name: 'deactivate_user_note',
    description: `Marca una nota como inactiva cuando ya no es relevante.
CUÁNDO USARLA:
- El usuario indica que la situación cambió o se resolvió ("ya volví del viaje", "la competición se canceló")
- La nota tiene fecha límite y esa fecha ya pasó (compara con HOY en el contexto)
- El usuario proporciona información que contradice directamente la nota
NO USARLA si hay duda: mejor mantener una nota antigua que perder información relevante.`,
    parameters: {
      type: 'object',
      properties: {
        note_id: {
          type: 'string',
          description: 'ID de la nota a desactivar, tal como aparece entre corchetes en NOTAS RECORDADAS: [uuid]'
        }
      },
      required: ['note_id']
    }
  }
]

export async function executeTool(name: string, userId: string, args: any): Promise<any> {
  const impl = TOOL_IMPLS[name]
  if (!impl) return { error: `Herramienta "${name}" no existe` }
  try {
    return await impl(userId, args || {})
  } catch (err: any) {
    return { error: `Error ejecutando ${name}: ${err?.message || 'unknown'}` }
  }
}
