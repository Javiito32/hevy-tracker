import { prisma } from './prisma'

type ToolFn = (userId: string, args: any) => Promise<any>

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

const fmtDate = (d: Date | string): string => new Date(d).toISOString().split('T')[0]

const summarizeWorkout = (w: any) => ({
  id: w.id,
  date: fmtDate(w.date),
  name: w.name,
  total_volume_kg: w.total_volume ? Math.round(Number(w.total_volume)) : null,
  rpe_avg: w.rpe_avg ? Number(w.rpe_avg) : null,
  notes: w.notes || undefined
})

const fullWorkout = (w: any) => {
  const exSummary: any[] = w.exercises_summary ? JSON.parse(w.exercises_summary) : []
  return {
    ...summarizeWorkout(w),
    exercises: exSummary.map(ex => ({
      name: ex.name,
      sets: ex.sets,
      total_volume_kg: ex.total_volume ?? null,
      estimated_1rm_kg: ex.estimated_1rm ? parseFloat(ex.estimated_1rm) : null,
      sets_details: (ex.sets_details || []).map((s: any) => ({
        weight_kg: s.weight ?? null,
        reps: s.reps ?? null,
        rpe: s.rpe ?? null,
        duration_s: s.duration_seconds ?? null,
        distance_m: s.distance_meters ?? null
      }))
    }))
  }
}

const getWorkoutsInRange: ToolFn = async (userId, args) => {
  const start = parseDate(args.start_date, daysAgo(14))!
  const end = parseDate(args.end_date, new Date())!
  const detail = args.detail === 'full' ? 'full' : 'summary'
  const workouts = await prisma.workout.findMany({
    where: { user_id: userId, date: { gte: start, lte: end } },
    orderBy: { date: 'asc' },
    select: { id: true, name: true, date: true, total_volume: true, rpe_avg: true, notes: true, exercises_summary: detail === 'full' }
  })
  return {
    range: { start: fmtDate(start), end: fmtDate(end) },
    count: workouts.length,
    workouts: workouts.map(detail === 'full' ? fullWorkout : summarizeWorkout)
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
  const sessions: any[] = []
  for (const w of workouts) {
    if (!w.exercises_summary) continue
    let exs: any[]
    try { exs = JSON.parse(w.exercises_summary) } catch { continue }
    const match = exs.find(e => (e.name as string).toLowerCase().includes(name))
    if (!match) continue
    sessions.push({
      date: fmtDate(w.date),
      sets: match.sets,
      total_volume_kg: match.total_volume ?? null,
      estimated_1rm_kg: match.estimated_1rm ? parseFloat(match.estimated_1rm) : null,
      top_set: (() => {
        const details = match.sets_details || []
        if (!details.length) return null
        const best = details.reduce((a: any, b: any) => {
          const va = (a?.weight ?? 0) * (a?.reps ?? 0)
          const vb = (b?.weight ?? 0) * (b?.reps ?? 0)
          return vb > va ? b : a
        })
        return { weight_kg: best.weight ?? null, reps: best.reps ?? null, rpe: best.rpe ?? null }
      })()
    })
  }
  return {
    exercise_query: args.exercise_name,
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
      date: true, weight: true, body_fat_percentage: true,
      neck: true, chest: true, waist: true, hips: true, biceps: true, thighs: true, calves: true
    }
  })
  return {
    range: { start: fmtDate(start), end: fmtDate(end) },
    count: metrics.length,
    metrics: metrics.map(m => ({
      date: fmtDate(m.date),
      weight_kg: m.weight ?? null,
      body_fat_pct: m.body_fat_percentage ?? null,
      neck_cm: m.neck ?? null,
      chest_cm: m.chest ?? null,
      waist_cm: m.waist ?? null,
      hips_cm: m.hips ?? null,
      biceps_cm: m.biceps ?? null,
      thighs_cm: m.thighs ?? null,
      calves_cm: m.calves ?? null
    }))
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
    mesocycle: { id: meso.id, name: meso.name, goal: meso.goal, status: meso.status, start: fmtDate(meso.start_date), end: meso.end_date ? fmtDate(meso.end_date) : null },
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
      final_summary: m.final_summary || undefined
    }))
  }
}

const getWeeklyAggregates: ToolFn = async (userId, args) => {
  const weeksBack = Math.min(Math.max(Number(args.weeks_back) || 8, 1), 26)
  const since = daysAgo(weeksBack * 7)
  const workouts = await prisma.workout.findMany({
    where: { user_id: userId, date: { gte: since } },
    orderBy: { date: 'asc' },
    select: { date: true, total_volume: true, rpe_avg: true }
  })
  const byWeek = new Map<string, { volumes: number[]; rpes: number[]; count: number }>()
  for (const w of workouts) {
    const d = new Date(w.date)
    const day = d.getDay()
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
    d.setHours(0, 0, 0, 0)
    const key = d.toISOString().split('T')[0]
    if (!byWeek.has(key)) byWeek.set(key, { volumes: [], rpes: [], count: 0 })
    const bucket = byWeek.get(key)!
    bucket.count++
    if (w.total_volume) bucket.volumes.push(Number(w.total_volume))
    if (w.rpe_avg) bucket.rpes.push(Number(w.rpe_avg))
  }
  return {
    weeks_back: weeksBack,
    weeks: Array.from(byWeek.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStart, b]) => ({
        week_start: weekStart,
        sessions: b.count,
        total_volume_kg: b.volumes.length ? Math.round(b.volumes.reduce((s, v) => s + v, 0)) : 0,
        avg_rpe: b.rpes.length ? Number((b.rpes.reduce((s, v) => s + v, 0) / b.rpes.length).toFixed(2)) : null
      }))
  }
}

const TOOL_IMPLS: Record<string, ToolFn> = {
  get_workouts_in_range: getWorkoutsInRange,
  get_workout_detail: getWorkoutDetail,
  get_exercise_progression: getExerciseProgression,
  get_body_metrics_range: getBodyMetricsRange,
  get_mesocycle_evaluations: getMesocycleEvaluations,
  get_previous_mesocycles: getPreviousMesocycles,
  get_weekly_aggregates: getWeeklyAggregates
}

export const OPENAI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_workouts_in_range',
      description: 'Obtiene entrenamientos del usuario en un rango de fechas. Úsalo cuando el usuario pregunte por entrenamientos pasados, semanas concretas o comparaciones de periodos.',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Fecha inicio en formato YYYY-MM-DD' },
          end_date: { type: 'string', description: 'Fecha fin en formato YYYY-MM-DD' },
          detail: { type: 'string', enum: ['summary', 'full'], description: 'summary = fecha/nombre/volumen/RPE. full = todas las series. Usa full solo si el usuario pregunta por ejercicios/series concretas.' }
        },
        required: ['start_date', 'end_date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_workout_detail',
      description: 'Obtiene un entrenamiento concreto con todas sus series. Usa workout_id si lo tienes, si no pasa date (YYYY-MM-DD).',
      parameters: {
        type: 'object',
        properties: {
          workout_id: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_exercise_progression',
      description: 'Progresión histórica de un ejercicio concreto (1RM estimado, volumen y mejor serie por sesión). Útil para analizar estancamientos o progreso en movimientos específicos.',
      parameters: {
        type: 'object',
        properties: {
          exercise_name: { type: 'string', description: 'Nombre o palabra clave del ejercicio (ej: "banca", "squat", "press militar")' },
          weeks_back: { type: 'number', description: 'Semanas hacia atrás a consultar (1-52, default 12)' }
        },
        required: ['exercise_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_body_metrics_range',
      description: 'Métricas corporales en un rango (peso, % grasa, medidas). Úsalo cuando el usuario pregunte por evolución de peso o composición corporal.',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'YYYY-MM-DD' },
          end_date: { type: 'string', description: 'YYYY-MM-DD' }
        },
        required: ['start_date', 'end_date']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_mesocycle_evaluations',
      description: 'Evaluaciones semanales de un mesociclo (por defecto el activo). Úsalo cuando el usuario pregunte por evaluaciones previas o progresión semanal dentro de un meso.',
      parameters: {
        type: 'object',
        properties: {
          mesocycle_id: { type: 'string', description: 'Opcional. Si se omite, usa el mesociclo activo.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_previous_mesocycles',
      description: 'Lista mesociclos completados o pausados con su resumen final. Úsalo cuando el usuario pregunte por mesociclos anteriores o quiera comparar con bloques previos.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Máx mesociclos a devolver (1-20, default 5)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_weekly_aggregates',
      description: 'Agregados semanales: # sesiones, volumen total y RPE medio por semana. Úsalo para ver tendencias de carga o adherencia.',
      parameters: {
        type: 'object',
        properties: {
          weeks_back: { type: 'number', description: 'Semanas hacia atrás (1-26, default 8)' }
        }
      }
    }
  }
] as const

export async function executeTool(name: string, userId: string, args: any): Promise<any> {
  const impl = TOOL_IMPLS[name]
  if (!impl) return { error: `Herramienta "${name}" no existe` }
  try {
    return await impl(userId, args || {})
  } catch (err: any) {
    return { error: `Error ejecutando ${name}: ${err?.message || 'unknown'}` }
  }
}
