import { prisma } from './prisma'

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface SetDetail {
  set: number
  weight_kg?: number
  reps?: number
  rpe?: number
  duration_s?: number
  distance_m?: number
}

export interface Exercise {
  name: string
  type: 'strength' | 'cardio' | 'duration'
  sets: number
  total_volume_kg?: number
  estimated_1rm_kg?: number
  total_distance_m?: number
  total_duration_s?: number
  sets_detail: SetDetail[]
}

export interface Workout {
  name: string
  date: string
  duration_min?: number
  total_volume_kg: number
  rpe_avg?: number
  notes?: string
  exercises?: Exercise[]
}

export interface WeightEntry {
  week: string
  avg_kg: number
  samples: number
}

export interface BodyMeasurements {
  date: string
  body_fat_pct?: number
  lean_mass_kg?: number
  neck_cm?: number
  shoulder_cm?: number
  chest_cm?: number
  waist_cm?: number
  abdomen_cm?: number
  hips_cm?: number
  left_bicep_cm?: number
  right_bicep_cm?: number
  left_bicep_relaxed_cm?: number
  right_bicep_relaxed_cm?: number
  left_forearm_cm?: number
  right_forearm_cm?: number
  left_thigh_cm?: number
  right_thigh_cm?: number
  left_calf_cm?: number
  right_calf_cm?: number
  hrv?: number
  resting_hr?: number
}

export interface AthleteProfile {
  name?: string
  sex?: string
  age_years?: number
  height_cm?: number
  weight_history: WeightEntry[]
  body_measurements?: {
    current?: BodyMeasurements
    one_month_ago?: BodyMeasurements
    three_months_ago?: BodyMeasurements
  }
  injuries_limitations?: string
}

export interface WeeklyEvaluation {
  week: number
  summary?: string
  volume_trend?: string
  recommendations?: string
}

export interface CompoundLift {
  exercise: string
  estimated_1rm_kg: number
  date: string
}

// ── Task Payload Types ─────────────────────────────────────────────────────────

export interface WorkoutAnalysisPayload {
  task: 'workout_analysis'
  today: string
  athlete: AthleteProfile
  workout: Workout
  historical_reference?: Workout[]
  active_mesocycle?: { name: string; goal?: string; split?: string }
}

export interface WeekEvaluationPayload {
  task: 'week_evaluation'
  today: string
  athlete: AthleteProfile
  mesocycle: { name: string; goal?: string; split?: string; sessions_per_week?: number }
  current_week: {
    number: number
    from: string
    to: string
    in_progress: boolean
    days_remaining?: number
    workouts: Workout[]
    total_volume_kg: number
    sessions_completed: number
    sessions_target?: number
    volume_trend: string
    volume_vs_previous_kg: number
    athlete_notes: Array<{ date: string; content: string }>
  }
  previous_weeks: Array<{
    number: number
    from: string
    to: string
    workouts: Omit<Workout, 'exercises'>[]
    total_volume_kg: number
  }>
  previous_evaluations: WeeklyEvaluation[]
}

export interface FinalSummaryPayload {
  task: 'final_summary'
  today: string
  athlete: AthleteProfile
  mesocycle: { name: string; goal?: string; split?: string }
  stats: {
    duration_days: number
    duration_weeks: number
    total_sessions: number
    total_volume_kg: number
    avg_rpe: number
  }
  first_workout?: Workout
  last_workout?: Workout
  weekly_evaluations: WeeklyEvaluation[]
  diary_notes: Array<{ date: string; content: string }>
}

export interface MesocycleFeedbackPayload {
  task: 'mesocycle_feedback'
  today: string
  athlete: AthleteProfile
  recent_workouts: Omit<Workout, 'exercises'>[]
  plan: {
    name?: string
    goal?: string
    duration_weeks?: number
    sessions_per_week?: number
    split_description?: string
    notes?: string
  }
  baseline_mesocycle?: {
    name: string
    goal?: string
    split?: string
    sessions_per_week?: number
    duration_weeks?: number
    weekly_progressions?: WeeklyEvaluation[]
  }
}

export interface MesocycleGeneratePayload {
  task: 'mesocycle_generate'
  today: string
  athlete: AthleteProfile
  recent_workouts: Workout[]
  compound_lifts: CompoundLift[]
  previous_mesocycles: Array<{ name: string; goal?: string; split?: string; sessions_per_week?: number }>
  request: { goal: string; days_per_week: number; duration_weeks: number; equipment?: string }
}

// ── Internal Helpers ───────────────────────────────────────────────────────────

function getWeekStartKey(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  d.setHours(0, 0, 0, 0)
  return d.toISOString().substring(0, 10)
}

function computeWeeklyWeights(
  metrics: Array<{ date: Date | string; weight: any }>,
  maxWeeks = 5
): Array<{ weekStart: string; avg: number; count: number }> {
  const byWeek = new Map<string, number[]>()
  for (const m of metrics) {
    if (m.weight == null) continue
    const key = getWeekStartKey(new Date(m.date))
    if (!byWeek.has(key)) byWeek.set(key, [])
    byWeek.get(key)!.push(Number(m.weight))
  }
  return Array.from(byWeek.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-maxWeeks)
    .map(([weekStart, weights]) => ({
      weekStart,
      avg: weights.reduce((s, w) => s + w, 0) / weights.length,
      count: weights.length
    }))
}

function buildMeasurementSnapshot(m: any): BodyMeasurements | undefined {
  if (!m) return undefined
  const n = (v: any) => parseFloat(Number(v).toFixed(1))
  const data: BodyMeasurements = { date: new Date(m.date).toISOString().substring(0, 10) }
  if (m.body_fat_percentage != null) data.body_fat_pct = n(m.body_fat_percentage)
  if (m.lean_mass != null) data.lean_mass_kg = n(m.lean_mass)
  if (m.neck != null) data.neck_cm = n(m.neck)
  if (m.shoulder != null) data.shoulder_cm = n(m.shoulder)
  if (m.chest != null) data.chest_cm = n(m.chest)
  if (m.waist != null) data.waist_cm = n(m.waist)
  if (m.abdomen != null) data.abdomen_cm = n(m.abdomen)
  if (m.hips != null) data.hips_cm = n(m.hips)
  if (m.left_bicep != null) data.left_bicep_cm = n(m.left_bicep)
  if (m.right_bicep != null) data.right_bicep_cm = n(m.right_bicep)
  if (m.left_bicep_relaxed != null) data.left_bicep_relaxed_cm = n(m.left_bicep_relaxed)
  if (m.right_bicep_relaxed != null) data.right_bicep_relaxed_cm = n(m.right_bicep_relaxed)
  if (m.left_forearm != null) data.left_forearm_cm = n(m.left_forearm)
  if (m.right_forearm != null) data.right_forearm_cm = n(m.right_forearm)
  if (m.left_thigh != null) data.left_thigh_cm = n(m.left_thigh)
  if (m.right_thigh != null) data.right_thigh_cm = n(m.right_thigh)
  if (m.left_calf != null) data.left_calf_cm = n(m.left_calf)
  if (m.right_calf != null) data.right_calf_cm = n(m.right_calf)
  if (m.hrv != null) data.hrv = n(m.hrv)
  if (m.resting_hr != null) data.resting_hr = Number(m.resting_hr)
  return Object.keys(data).length > 1 ? data : undefined
}

// ── Public Builders ────────────────────────────────────────────────────────────

const COMPOUND_KEYWORDS = [
  'banca', 'bench press', 'press banca', 'press de banca',
  'sentadilla', 'squat', 'peso muerto', 'deadlift',
  'press militar', 'press sobre cabeza', 'overhead press', 'ohp', 'press de hombros',
  'remo con barra', 'barbell row', 'remo', 'seal row', 'hip thrust',
  'dominadas', 'pull-up', 'pullup', 'jalón al pecho', 'fondos', 'dips',
  'press inclinado', 'incline press', 'press inclinado con barra',
  'peso muerto rumano', 'romanian deadlift', 'rdl', 'zancadas', 'lunges',
  'leg press', 'prensa', 'press arnold', 'press mancuernas'
]

export function extractCompoundLiftsData(workouts: any[]): CompoundLift[] {
  const best = new Map<string, { rm: number; date: string }>()
  for (const w of workouts) {
    if (!w.exercises_summary) continue
    let exs: any[]
    try { exs = JSON.parse(w.exercises_summary) } catch { continue }
    for (const ex of exs) {
      if (!ex.estimated_1rm || ex.type === 'cardio' || ex.type === 'duration') continue
      const nameLower = (ex.name as string).toLowerCase()
      if (!COMPOUND_KEYWORDS.some(kw => nameLower.includes(kw))) continue
      const rm = parseFloat(ex.estimated_1rm)
      if (isNaN(rm)) continue
      const existing = best.get(ex.name)
      if (!existing || rm > existing.rm) {
        best.set(ex.name, { rm, date: new Date(w.date).toISOString().substring(0, 10) })
      }
    }
  }
  return Array.from(best.entries())
    .sort((a, b) => b[1].rm - a[1].rm)
    .map(([exercise, { rm, date }]) => ({ exercise, estimated_1rm_kg: parseFloat(rm.toFixed(1)), date }))
}

export function buildWorkoutData(w: any, includeExercises = true): Workout {
  const workout: Workout = {
    name: w.name,
    date: new Date(w.date).toISOString().substring(0, 10),
    total_volume_kg: Math.round(Number(w.total_volume ?? 0)),
  }
  if (w.rpe_avg) workout.rpe_avg = Number(w.rpe_avg)
  if (w.notes) workout.notes = w.notes
  if (w.duration) workout.duration_min = Math.round(w.duration / 60)

  if (includeExercises && w.exercises_summary) {
    try {
      const exs: any[] = typeof w.exercises_summary === 'string'
        ? JSON.parse(w.exercises_summary)
        : w.exercises_summary
      workout.exercises = exs.map((ex): Exercise => {
        const isCardio = ex.type === 'cardio' || ex.type === 'duration'
        const exercise: Exercise = {
          name: ex.name,
          type: isCardio ? (ex.type as 'cardio' | 'duration') : 'strength',
          sets: ex.sets,
          sets_detail: (ex.sets_details || []).map((s: any, i: number): SetDetail => {
            const detail: SetDetail = { set: i + 1 }
            if (s.weight != null) detail.weight_kg = Number(s.weight)
            if (s.reps != null) detail.reps = Number(s.reps)
            if (s.rpe) detail.rpe = Number(s.rpe)
            if (s.duration_seconds) detail.duration_s = s.duration_seconds
            if (s.distance_meters) detail.distance_m = s.distance_meters
            return detail
          })
        }
        if (!isCardio) {
          exercise.total_volume_kg = Math.round(Number(ex.total_volume ?? 0))
          if (ex.estimated_1rm) {
            exercise.estimated_1rm_kg = parseFloat(parseFloat(ex.estimated_1rm).toFixed(1))
          }
        }
        if (ex.total_distance_meters) exercise.total_distance_m = ex.total_distance_meters
        if (ex.total_duration_seconds) exercise.total_duration_s = ex.total_duration_seconds
        return exercise
      })
    } catch {
      // exercises remain undefined
    }
  }

  return workout
}

export async function buildAthleteProfile(
  userId: string,
  options: { includeInjuries?: boolean } = {}
): Promise<AthleteProfile> {
  const now = new Date()
  const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return d }

  const [user, recentWeights, currentMetric, metric1m, metric3m] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, sex: true, birth_date: true, height: true, injuries_notes: true }
    }),
    prisma.bodyMetric.findMany({
      where: { user_id: userId, date: { gte: daysAgo(70) } },
      orderBy: { date: 'asc' },
      select: { weight: true, date: true }
    }),
    prisma.bodyMetric.findFirst({ where: { user_id: userId }, orderBy: { date: 'desc' } }),
    prisma.bodyMetric.findFirst({
      where: { user_id: userId, date: { gte: daysAgo(42), lte: daysAgo(21) } },
      orderBy: { date: 'desc' }
    }),
    prisma.bodyMetric.findFirst({
      where: { user_id: userId, date: { gte: daysAgo(105), lte: daysAgo(70) } },
      orderBy: { date: 'desc' }
    })
  ])

  const weeklyWeights = computeWeeklyWeights(recentWeights)

  const profile: AthleteProfile = {
    weight_history: weeklyWeights.map(w => ({
      week: w.weekStart,
      avg_kg: parseFloat(w.avg.toFixed(1)),
      samples: w.count
    }))
  }

  if (user?.name && user.name !== 'User') profile.name = user.name
  if (user?.sex) profile.sex = user.sex
  if (user?.birth_date) {
    profile.age_years = Math.floor(
      (Date.now() - new Date(user.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    )
  }
  if (user?.height) profile.height_cm = Number(user.height)
  if (options.includeInjuries && user?.injuries_notes) {
    profile.injuries_limitations = user.injuries_notes
  }

  const currentSnap = buildMeasurementSnapshot(currentMetric)
  const prev1mSnap = buildMeasurementSnapshot(metric1m)
  const prev3mSnap = buildMeasurementSnapshot(metric3m)
  if (currentSnap || prev1mSnap || prev3mSnap) {
    profile.body_measurements = {}
    if (currentSnap) profile.body_measurements.current = currentSnap
    if (prev1mSnap) profile.body_measurements.one_month_ago = prev1mSnap
    if (prev3mSnap) profile.body_measurements.three_months_ago = prev3mSnap
  }

  return profile
}

export async function buildLastMesocycleSummaryData(userId: string): Promise<MesocycleFeedbackPayload['baseline_mesocycle']> {
  const meso = await prisma.mesocycle.findFirst({
    where: { user_id: userId, status: 'completed' },
    orderBy: { end_date: 'desc' },
    select: {
      name: true,
      goal: true,
      split_description: true,
      target_volume_weekly: true,
      start_date: true,
      end_date: true,
      evaluations: {
        orderBy: { week_number: 'asc' },
        select: { week_number: true, summary: true, volume_trend: true }
      }
    }
  })
  if (!meso) return undefined

  const durationWeeks = (meso.end_date && meso.start_date)
    ? Math.round(
        (new Date(meso.end_date).getTime() - new Date(meso.start_date).getTime()) /
        (7 * 24 * 60 * 60 * 1000)
      )
    : undefined

  return {
    name: meso.name,
    ...(meso.goal && { goal: meso.goal }),
    ...(meso.split_description && { split: meso.split_description }),
    ...(meso.target_volume_weekly != null && { sessions_per_week: meso.target_volume_weekly }),
    ...(durationWeeks && { duration_weeks: durationWeeks }),
    ...(meso.evaluations.length && {
      weekly_progressions: meso.evaluations.map(e => ({
        week: e.week_number,
        ...(e.summary && { summary: e.summary }),
        ...(e.volume_trend && { volume_trend: e.volume_trend })
      }))
    })
  }
}
