import { prisma } from './prisma'
import { localDayKey, localWeekKey } from './dates'
import { resolveVersion, serializeDietForAi } from './diet-service'
import { loadTemplateTitles, normalizeExerciseName, resolveTitle } from './exercise-aliases'
import { WEEKDAY_LABELS_ES, isWeekday } from './nutrition-calculator'
import type { WorkoutVsPlan, WeekAdherenceRow } from './plan-service'

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface SetDetail {
  set: number
  /**
   * Only emitted for non-'normal' sets, so the model reads a marker rather than
   * a column that says "normal" on every row. A 'warmup' set must not be read
   * as effective work.
   */
  type?: 'warmup' | 'dropset' | 'failure'
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
  /** Present when the caller has it — chat tools use it to fetch the same session. */
  id?: string
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
  active_notes?: string[]
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

/**
 * The planned diet as the AI sees it. A PLAN, never a log of what was actually
 * eaten — every prompt that receives this must say so, or the model will report
 * intake it has no evidence for.
 */
export interface NutritionSnapshot {
  plan_name: string
  goal?: string
  version_number: number
  in_force_since?: string
  /**
   * The MEAN of a planned day — not a weekly total, and not a mean over seven.
   * `planned_days_per_week` says what it averages over. The field names predate
   * the weekday split and are kept so the prompts read unchanged.
   */
  daily_kcal: number | null
  daily_protein_g: number | null
  daily_carbs_g: number | null
  daily_fat_g: number | null
  planned_days_per_week?: number
  planned_weekdays?: string[]
  protein_g_per_kg?: number
  macro_split_pct?: { protein: number | null; carbs: number | null; fat: number | null }
  targets?: { kcal?: number; protein_g?: number; carbs_g?: number; fat_g?: number }
  /** Only the weekdays whose target departs from the base one. */
  targets_by_weekday?: Array<{
    weekday: string
    kcal: number | null
    protein_g: number | null
    carbs_g: number | null
    fat_g: number | null
  }>
  /**
   * Only the micros with data. A micro absent here is missing from the food
   * database, not an intake of zero.
   */
  micronutrients?: Record<string, number>
  /**
   * Micros whose figure above came from only some of the foods, and is
   * therefore a LOWER BOUND. Shipped so the model can't read an incomplete
   * total as a deficiency — the prompts spell out that rule.
   */
  micronutrients_partial?: Record<string, string>
  /**
   * One line per distinct day pattern, identical weekdays grouped. **Always
   * complete** — it is the menu that gets abridged or dropped, never the
   * numbers, so every task can still judge energy and macros day by day.
   */
  days?: Array<{
    weekdays: string[]
    kcal: number | null
    protein_g: number | null
    carbs_g: number | null
    fat_g: number | null
  }>
  /** The weekdays whose menu `meals` actually describes. */
  meals_apply_to?: string[]
  /** True when other days have a different menu that is not in this payload. */
  meals_other_days_omitted?: boolean
  /** True when no menu at all travelled — `detail: 'macros'`. */
  meals_omitted?: boolean
  note?: string
  /** Absent under `detail: 'macros'`: the numbers above stand on their own. */
  meals?: Array<{
    name: string
    time_of_day?: string
    foods: Array<{ name: string; quantity_g: number }>
  }>
  /**
   * Every distinct day's menu, identical weekdays grouped. Only under
   * `detail: 'full'` — what `get_diet` returns when the model asked for the
   * diet on purpose.
   */
  meals_by_day?: Array<{
    weekdays: string[]
    meals: Array<{
      name: string
      time_of_day?: string
      foods: Array<{ name: string; quantity_g: number }>
    }>
  }>
  /** Which weekdays the athlete trains on, from the active mesocycle's plan. */
  training_weekdays?: string[]
}

export interface NutritionHistoryEntry {
  version_number: number
  from: string
  to?: string
  change_note?: string
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

// ── Task Payload Types ─────────────────────────────────────────────────────────

export interface WorkoutAnalysisPayload {
  task: 'workout_analysis'
  today: string
  athlete: AthleteProfile
  workout: Workout
  historical_reference?: Workout[]
  active_mesocycle?: { name: string; goal?: string; split?: string }
  /** The planned session this workout matched, when there is a structured plan. */
  prescribed?: WorkoutVsPlan
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
  /**
   * Diary notes from the weeks *before* the one being evaluated. They used to be
   * merged into `current_week.athlete_notes`, which had the model attributing a
   * month-old "dormí fatal" to the week it was judging.
   */
  earlier_notes?: Array<{ date: string; content: string }>
  previous_evaluations: WeeklyEvaluation[]
  nutrition?: NutritionSnapshot
  week_adherence?: { overall_pct: number | null; rows: WeekAdherenceRow[] }
  muscle_volume?: Array<{
    muscle: string
    label: string
    avg_weekly_sets: number
    verdict: string
    mev?: number
    mav?: number
    mrv?: number
  }>
  alerts?: Array<{ type: string; subject: string; title: string; severity: string }>
}

export interface FinalSummaryPayload {
  task: 'final_summary'
  today: string
  /**
   * The date every window in this payload is closed at: the block's end, or
   * today while it is still open. Printed in the profile heading so the model
   * cannot read a finished block's profile as the athlete's current one.
   */
  as_of?: string
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
  nutrition?: NutritionSnapshot
  nutrition_history?: NutritionHistoryEntry[]
  lift_progression?: LiftProgression[]
  block_records?: BlockRecord[]
}

export interface LiftProgression {
  exercise: string
  first_e1rm_kg: number | null
  last_e1rm_kg: number | null
  best_e1rm_kg: number | null
  first_date: string
  last_date: string
  sessions: number
  delta_kg: number | null
}

export interface BlockRecord {
  exercise: string
  type: string
  value: number
  previous_value: number | null
  date: string
}

export interface MesocycleFeedbackPayload {
  task: 'mesocycle_feedback'
  today: string
  athlete: AthleteProfile
  recent_workouts: Workout[]
  plan: {
    name?: string
    goal?: string
    duration_weeks?: number
    sessions_per_week?: number
    split_description?: string
    notes?: string
    sessions?: Array<{
      name: string
      day_of_week?: number | null
      exercises: Array<{
        name: string
        target_sets?: number
        rep_min?: number | null
        rep_max?: number | null
        target_rir?: number | null
      }>
    }>
    weeks?: Array<{
      week_number: number
      is_deload?: boolean
      target_rir?: number | null
      volume_multiplier?: number
    }>
  }
  baseline_mesocycle?: {
    name: string
    goal?: string
    split?: string
    sessions_per_week?: number
    duration_weeks?: number
    weekly_progressions?: WeeklyEvaluation[]
  }
  nutrition?: NutritionSnapshot
}

export interface MesocycleGeneratePayload {
  task: 'mesocycle_generate'
  today: string
  athlete: AthleteProfile
  recent_workouts: Workout[]
  compound_lifts: CompoundLift[]
  previous_mesocycles: Array<{ name: string; goal?: string; split?: string; sessions_per_week?: number }>
  request: { goal: string; days_per_week: number; duration_weeks: number; equipment?: string }
  nutrition?: NutritionSnapshot
  /**
   * Weekly sets per muscle group against MEV/MAV/MRV. Present once the exercise
   * catalogue is synced — it lets the new block correct what the previous one
   * actually under- or over-trained.
   */
  muscle_volume?: Array<{
    muscle: string
    label: string
    avg_weekly_sets: number
    verdict: string
    mev?: number
    mav?: number
    mrv?: number
  }>
}

export interface NutritionAnalysisPayload {
  task: 'nutrition_analysis'
  today: string
  athlete: AthleteProfile
  nutrition: NutritionSnapshot
  nutrition_history: NutritionHistoryEntry[]
  training_load: Array<{ week: string; sessions: number; total_volume_kg: number; avg_rpe: number | null }>
  active_mesocycle?: { name: string; goal?: string; split?: string }
}

export interface NutritionTargetsPayload {
  task: 'nutrition_targets'
  today: string
  athlete: AthleteProfile
  request: { goal: string; rate_kg_per_week?: number; notes?: string }
  current_nutrition?: NutritionSnapshot
  nutrition_history: NutritionHistoryEntry[]
  training_load: Array<{ week: string; sessions: number; total_volume_kg: number; avg_rpe: number | null }>
}

// ── Internal Helpers ───────────────────────────────────────────────────────────

function computeWeeklyWeights(
  metrics: Array<{ date: Date | string; weight: any }>,
  maxWeeks = 5
): Array<{ weekStart: string; avg: number; count: number }> {
  const byWeek = new Map<string, number[]>()
  for (const m of metrics) {
    if (m.weight == null) continue
    const key = localWeekKey(new Date(m.date))
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
        best.set(ex.name, { rm, date: localDayKey(new Date(w.date)) })
      }
    }
  }
  return Array.from(best.entries())
    .sort((a, b) => b[1].rm - a[1].rm)
    .map(([exercise, { rm, date }]) => ({ exercise, estimated_1rm_kg: parseFloat(rm.toFixed(1)), date }))
}

/**
 * Best e1RM per compound lift across the whole history, not the last handful
 * of sessions. Generation used to scan five recent workouts, so a squat last
 * trained six sessions ago vanished from "fuerza actual".
 *
 * Personal-record rows overlay the scan when they exist and are higher — they
 * are the stored best, and `rebuild_records` may not have run.
 */
export async function buildCurrentStrength(userId: string, limit = 20): Promise<CompoundLift[]> {
  const [rows, records, aliases] = await Promise.all([
    prisma.workoutExercise.findMany({
      where: { user_id: userId, best_e1rm: { not: null } },
      select: { name: true, exercise_template_id: true, best_e1rm: true, date: true }
    }),
    prisma.personalRecord.findMany({
      where: { user_id: userId, type: 'e1rm' },
      select: { exercise_name: true, exercise_template_id: true, value: true, achieved_at: true }
    }),
    loadTemplateTitles(userId)
  ])

  const isCompound = (name: string) => {
    const lower = name.toLowerCase()
    return COMPOUND_KEYWORDS.some(kw => lower.includes(kw))
  }

  const best = new Map<string, { name: string; rm: number; date: Date }>()
  const consider = (
    templateId: string | null,
    rawName: string,
    rm: number,
    date: Date
  ) => {
    const name = templateId ? resolveTitle(aliases, templateId, rawName) : rawName
    if (!isCompound(name)) return
    const key = templateId || `name:${normalizeExerciseName(rawName)}`
    const cur = best.get(key)
    if (!cur || rm > cur.rm) best.set(key, { name, rm, date })
  }

  for (const r of rows) {
    if (r.best_e1rm == null) continue
    consider(r.exercise_template_id, r.name, r.best_e1rm, r.date)
  }
  for (const rec of records) {
    consider(rec.exercise_template_id, rec.exercise_name, rec.value, rec.achieved_at)
  }

  return [...best.values()]
    .sort((a, b) => b.rm - a.rm)
    .slice(0, limit)
    .map(x => ({
      exercise: x.name,
      estimated_1rm_kg: parseFloat(x.rm.toFixed(1)),
      date: localDayKey(x.date)
    }))
}

/**
 * How each lift moved across one block: first / last / best e1RM, plus the
 * records the detector stored during those dates.
 *
 * The final-summary prompt used to be asked for "inicio vs final: cargas" and
 * handed the first and last *sessions*, which are almost never the same
 * routine. This is the comparison that question actually needs.
 */
export async function buildBlockLiftProgression(
  userId: string,
  mesocycleId: string,
  asOf: Date
): Promise<{ lifts: LiftProgression[]; records: BlockRecord[] }> {
  const [rows, records, aliases] = await Promise.all([
    prisma.workoutExercise.findMany({
      where: {
        user_id: userId,
        date: { lte: asOf },
        workout: { mesocycle_id: mesocycleId },
        best_e1rm: { not: null }
      },
      orderBy: { date: 'asc' },
      select: { name: true, exercise_template_id: true, date: true, best_e1rm: true }
    }),
    prisma.personalRecord.findMany({
      where: {
        user_id: userId,
        achieved_at: { lte: asOf },
        workout: { mesocycle_id: mesocycleId }
      },
      orderBy: { achieved_at: 'asc' },
      select: {
        exercise_name: true, exercise_template_id: true, type: true,
        value: true, previous_value: true, achieved_at: true
      }
    }),
    loadTemplateTitles(userId)
  ])

  type Acc = {
    name: string
    first: number
    last: number
    best: number
    firstDate: Date
    lastDate: Date
    sessions: number
  }
  const byKey = new Map<string, Acc>()
  for (const r of rows) {
    if (r.best_e1rm == null) continue
    const key = r.exercise_template_id || `name:${normalizeExerciseName(r.name)}`
    const name = r.exercise_template_id ? resolveTitle(aliases, r.exercise_template_id, r.name) : r.name
    const cur = byKey.get(key)
    if (!cur) {
      byKey.set(key, {
        name, first: r.best_e1rm, last: r.best_e1rm, best: r.best_e1rm,
        firstDate: r.date, lastDate: r.date, sessions: 1
      })
    } else {
      cur.last = r.best_e1rm
      cur.lastDate = r.date
      if (r.best_e1rm > cur.best) cur.best = r.best_e1rm
      cur.sessions++
    }
  }

  const lifts: LiftProgression[] = [...byKey.values()]
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 25)
    .map(a => ({
      exercise: a.name,
      first_e1rm_kg: parseFloat(a.first.toFixed(1)),
      last_e1rm_kg: parseFloat(a.last.toFixed(1)),
      best_e1rm_kg: parseFloat(a.best.toFixed(1)),
      first_date: localDayKey(a.firstDate),
      last_date: localDayKey(a.lastDate),
      sessions: a.sessions,
      delta_kg: parseFloat((a.last - a.first).toFixed(1))
    }))

  const RECORD_TYPE_LABEL: Record<string, string> = {
    max_weight: 'Peso máximo',
    e1rm: '1RM estimado',
    volume: 'Volumen en sesión',
    reps_at_weight: 'Repeticiones a un peso'
  }

  const blockRecords: BlockRecord[] = records.map(r => ({
    exercise: r.exercise_template_id
      ? resolveTitle(aliases, r.exercise_template_id, r.exercise_name)
      : r.exercise_name,
    type: RECORD_TYPE_LABEL[r.type] ?? r.type,
    value: r.value,
    previous_value: r.previous_value,
    date: localDayKey(r.achieved_at)
  }))

  return { lifts, records: blockRecords }
}

export function buildWorkoutData(w: any, includeExercises = true): Workout {
  const workout: Workout = {
    ...(w.id && { id: String(w.id) }),
    name: w.name,
    // Local components: `Workout.date` is the instant the session started, and
    // `toISOString()` on a 00:30 session in Madrid dates it to the day before —
    // so the analysis and the athlete's calendar disagreed about when they
    // trained. Same rule as `localWeekKey` below and everywhere else in the app.
    date: localDayKey(new Date(w.date)),
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
          sets: ex.working_sets ?? ex.sets,
          sets_detail: (ex.sets_details || []).map((s: any, i: number): SetDetail => {
            const detail: SetDetail = { set: i + 1 }
            if (s.type && s.type !== 'normal') detail.type = s.type
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

/**
 * The athlete, as of a point in time.
 *
 * **`asOf` is what stops a March session being explained with August's body.**
 * Every window below is measured backwards from the reference date and nothing
 * later than it is loaded, so re-analysing an old workout produces the profile
 * the athlete had when they trained it — the weight they were carrying, the
 * measurements that were current, the notes that were live. With the default
 * (now) the behaviour is exactly what it was.
 *
 * `includeInjuries` defaults to **true**. It used to default to false and only
 * `ai-generate` opted in, which meant every other task that recommends
 * exercises — the workout analysis, the weekly evaluation, the plan feedback —
 * prescribed into a shoulder the database knew was injured. A limitation is
 * cheap to carry and expensive to omit, so the opt-out is the exception now.
 */
export async function buildAthleteProfile(
  userId: string,
  options: { includeInjuries?: boolean; includeNotes?: boolean; asOf?: Date } = {}
): Promise<AthleteProfile> {
  const now = options.asOf ?? new Date()
  const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return d }

  const [user, recentWeights, currentMetric, metric1m, metric3m, notes] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, sex: true, birth_date: true, height: true, injuries_notes: true }
    }),
    prisma.bodyMetric.findMany({
      where: { user_id: userId, date: { gte: daysAgo(70), lte: now } },
      orderBy: { date: 'asc' },
      select: { weight: true, date: true }
    }),
    prisma.bodyMetric.findFirst({ where: { user_id: userId, date: { lte: now } }, orderBy: { date: 'desc' } }),
    prisma.bodyMetric.findFirst({
      where: { user_id: userId, date: { gte: daysAgo(42), lte: daysAgo(21) } },
      orderBy: { date: 'desc' }
    }),
    prisma.bodyMetric.findFirst({
      where: { user_id: userId, date: { gte: daysAgo(105), lte: daysAgo(70) } },
      orderBy: { date: 'desc' }
    }),
    // Notes that existed *and were still live* at the reference date. A note
    // deactivated afterwards was true at the time, so `updated_at > asOf`
    // readmits it; one created afterwards is information the athlete did not
    // have yet and never explains what happened before it.
    prisma.aiNote.findMany({
      where: {
        user_id: userId,
        created_at: { lte: now },
        OR: [{ is_active: true }, { updated_at: { gt: now } }]
      },
      orderBy: { created_at: 'asc' },
      select: { content: true }
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
    // Age at the reference date, not today's: a two-year-old block analysed now
    // was not trained by a 33-year-old.
    profile.age_years = Math.floor(
      (now.getTime() - new Date(user.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
    )
  }
  if (user?.height) profile.height_cm = Number(user.height)
  if (options.includeInjuries !== false && user?.injuries_notes) {
    profile.injuries_limitations = user.injuries_notes
  }
  // `includeNotes: false` is for the chat, and only for the chat: it renders the
  // same notes itself, WITH the ids `deactivate_user_note` needs. Printing them
  // in both places sent every note twice on every turn of every conversation.
  if (options.includeNotes !== false && notes.length > 0) {
    profile.active_notes = notes.map(n => n.content)
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

/**
 * Earlier sessions that share exercises with the one being analysed.
 *
 * The order of operations is the whole point. This used to take the five most
 * recent workouts in a fixed 21–35 day window and *then* filter them to the
 * relevant exercises, so a session whose lifts were last trained 20 or 40 days
 * ago produced an empty reference, and one trained in a week full of other work
 * produced five sessions with nothing in common. Candidates are selected by the
 * exercises first, over a window wide enough to contain them, and only then
 * limited — which is the difference between "the last five workouts, some of
 * which may be comparable" and "the last N comparable workouts".
 *
 * Matching goes through `exercise_template_id`, with the normalised name as the
 * fallback for exercises the catalogue never resolved. Matching by name alone
 * is the bug documented in `exercise-aliases.ts`: the catalogue answers in
 * English and the workouts in the athlete's language.
 *
 * Nothing dated on or after the analysed session is ever a candidate — a
 * comparison against a future session is not a trend, it is hindsight.
 */
export async function buildHistoricalReference(
  userId: string,
  workout: { id: string; date: Date; exercises_summary: string | null },
  options: { limit?: number; windowDays?: number } = {}
): Promise<Workout[]> {
  const limit = options.limit ?? 4
  const windowDays = options.windowDays ?? 120

  let current: any[]
  try { current = workout.exercises_summary ? JSON.parse(workout.exercises_summary) : [] } catch { return [] }
  if (!current.length) return []

  const templateIds = new Set(current.map(e => e.exercise_template_id).filter(Boolean) as string[])
  const names = new Set<string>(current.map(e => String(e.name ?? '')).filter(Boolean))
  const normalizedNames = new Set([...names].map(normalizeExerciseName))
  if (!templateIds.size && !normalizedNames.size) return []

  const from = new Date(workout.date)
  from.setDate(from.getDate() - windowDays)

  // Candidate ids off the normalised table, which is indexed by (user_id, date)
  // and carries the template id — one query, no summaries parsed.
  const hits = await prisma.workoutExercise.findMany({
    where: {
      user_id: userId,
      date: { gte: from, lt: workout.date },
      OR: [
        ...(templateIds.size ? [{ exercise_template_id: { in: [...templateIds] } }] : []),
        ...(names.size ? [{ name: { in: [...names] } }] : [])
      ]
    },
    orderBy: { date: 'desc' },
    select: { workout_id: true }
  })

  const candidateIds = [...new Set(hits.map(h => h.workout_id))]

  const candidates = candidateIds.length
    ? await prisma.workout.findMany({
        where: { id: { in: candidateIds }, user_id: userId },
        orderBy: { date: 'desc' },
        // A few more than needed: a candidate can still drop out below if the
        // overlap came from a row the summary no longer contains.
        take: limit * 2,
        select: { name: true, date: true, total_volume: true, rpe_avg: true, notes: true, duration: true, exercises_summary: true }
      })
    // Databases whose `WorkoutExercise` rows were never built (the table is
    // derived, and `rebuild_exercises` may not have run) would otherwise report
    // "no history" for an athlete with years of it. Bounded scan of the window.
    : await prisma.workout.findMany({
        where: { user_id: userId, date: { gte: from, lt: workout.date } },
        orderBy: { date: 'desc' },
        take: 60,
        select: { name: true, date: true, total_volume: true, rpe_avg: true, notes: true, duration: true, exercises_summary: true }
      })

  const reference: Workout[] = []
  for (const candidate of candidates) {
    if (reference.length >= limit) break
    let exs: any[]
    try { exs = candidate.exercises_summary ? JSON.parse(candidate.exercises_summary) : [] } catch { continue }
    const relevant = exs.filter(e =>
      (e.exercise_template_id && templateIds.has(e.exercise_template_id)) ||
      normalizedNames.has(normalizeExerciseName(String(e.name ?? '')))
    )
    if (!relevant.length) continue
    reference.push(buildWorkoutData({ ...candidate, exercises_summary: JSON.stringify(relevant) }))
  }

  // Oldest first: a progression read top to bottom is the one the prompt asks
  // for, and two adjacent lists running in opposite directions is how a model
  // reports a trend backwards.
  return reference.reverse()
}

export async function buildLastMesocycleSummaryData(userId: string): Promise<MesocycleFeedbackPayload['baseline_mesocycle']> {
  const meso = await prisma.mesocycle.findFirst({
    where: { user_id: userId, status: 'completed' },
    orderBy: { end_date: 'desc' },
    select: {
      name: true,
      goal: true,
      split_description: true,
      target_sessions_weekly: true,
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
    ...(meso.target_sessions_weekly != null && { sessions_per_week: meso.target_sessions_weekly }),
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

// ── Nutrition ──────────────────────────────────────────────────────────────────

/**
 * Prisma filter for "the athlete's block, as of a date".
 *
 * With no date that is simply the active one. With a date it is the block whose
 * range contains it, whatever its status today — a block that has since been
 * completed was the block in force back then, and the one that is active now
 * had not started.
 */
function mesocycleAtFilter(userId: string, asOf?: Date) {
  if (!asOf) return { user_id: userId, status: 'active' }
  return {
    user_id: userId,
    start_date: { lte: asOf },
    OR: [{ end_date: null }, { end_date: { gte: asOf } }]
  }
}

/**
 * The active diet, shaped for a JSON payload.
 *
 * Returns undefined when there is no published diet — callers spread it
 * conditionally so the field is absent rather than null, and a prompt that
 * never sees `nutrition` simply says nothing about it.
 *
 * Reads the version's stored totals; it does not recompute. Those totals were
 * written by recalcVersionTotals() at edit time and are what the history and
 * the UI already show, so the AI can never be told a different number than the
 * user is looking at.
 */
export async function buildNutritionSnapshot(
  userId: string,
  options: { detail?: 'macros' | 'representative' | 'full'; asOf?: Date } = {}
): Promise<NutritionSnapshot | undefined> {
  // With `asOf`, the version that was in force on that date — the diet the
  // athlete was actually following while the block being judged was trained,
  // not the one they switched to afterwards.
  //
  // The key is built from LOCAL components. `toISOString()` on a Date at local
  // midnight hands back the previous day in any positive-offset timezone, which
  // is how a snapshot dated to a Monday resolved the version in force on the
  // Sunday — and on a publish-and-replace boundary those are different diets.
  const version = await resolveVersion(userId, {
    ...(options.asOf && { date: localDayKey(options.asOf) })
  })
  if (!version) return undefined

  const plan = await prisma.dietPlan.findUnique({ where: { id: version.diet_plan_id } })
  if (!plan) return undefined

  const [latestWeight, trainingSessions] = await Promise.all([
    prisma.bodyMetric.findFirst({
      // Bounded by the reference date too: g/kg of protein is a ratio, and
      // dividing a past diet by today's body weight is the same anachronism.
      where: { user_id: userId, weight: { not: null }, ...(options.asOf && { date: { lte: options.asOf } }) },
      orderBy: { date: 'desc' },
      select: { weight: true }
    }),
    // Which weekdays the athlete actually trains, straight off the mesocycle
    // that was running AT THE REFERENCE DATE. This is what the old training/rest
    // day_type buckets were reaching for, now grounded in the plan instead of a
    // manual flag: it turns "your carbs are 320 g" into "your carbs are highest
    // on your rest days".
    //
    // Reading `status: 'active'` regardless of `asOf` was the leak: judging a
    // diet from March against the block that started in July labels the wrong
    // days as training days, and the whole point of the field is which days
    // those were.
    prisma.plannedSession.findMany({
      where: { mesocycle: mesocycleAtFilter(userId, options.asOf), day_of_week: { not: null } },
      select: { day_of_week: true },
      distinct: ['day_of_week']
    })
  ])

  const trainingWeekdays = trainingSessions
    .map(s => s.day_of_week)
    .filter(isWeekday)
    .sort((a, b) => a - b)
    .map(d => WEEKDAY_LABELS_ES[d].toLowerCase())

  // Defaults to 'macros': this snapshot rides in every context payload, and the
  // training-side tasks judge the diet by whether its energy and macros fuel the
  // week — the food list is a few hundred tokens they never cite. Only the diet
  // analysis, whose output is "sube este alimento 30 g", asks for the menu.
  const diet = serializeDietForAi(version, {
    weightKg: latestWeight?.weight ?? null,
    detail: options.detail ?? 'macros'
  })

  // The tool payload carries a few fields only a tool result needs (its own id,
  // the draft/active status); the snapshot renames the rest to the names every
  // prompt already refers to.
  const { is_plan_not_log, version_id, status, from, to, daily_totals, version_number, ...rest } =
    diet as any
  const { kcal, protein_g, carbs_g, fat_g, ...micronutrients } = daily_totals ?? {}

  return {
    plan_name: plan.name,
    ...(plan.goal && { goal: plan.goal }),
    version_number,
    ...(from && { in_force_since: from }),
    // Names kept from before the weekday split so every prompt reads unchanged —
    // but these are now the MEAN of a planned day. `planned_days_per_week` in
    // `rest` is what stops that from being read as a seven-day average.
    daily_kcal: kcal ?? null,
    daily_protein_g: protein_g ?? null,
    daily_carbs_g: carbs_g ?? null,
    daily_fat_g: fat_g ?? null,
    ...(Object.keys(micronutrients).length > 0 && { micronutrients }),
    ...(trainingWeekdays.length > 0 && { training_weekdays: trainingWeekdays }),
    ...rest
  } as NutritionSnapshot
}

/**
 * Published diet versions over time, newest first. Drafts are excluded: they
 * were never followed, so they are not part of what the athlete ate.
 *
 * **`asOf` cuts off the future.** A block that ended in June is summarised with
 * the diets that existed by June; a version published in August is not part of
 * its story, and listing it invites the model to explain the block's outcome
 * with a change made after it finished. The default (now) is unchanged.
 */
export async function buildNutritionHistory(
  userId: string,
  limit = 12,
  asOf?: Date
): Promise<NutritionHistoryEntry[]> {
  const plan = await prisma.dietPlan.findFirst({
    where: { user_id: userId, status: 'active' },
    orderBy: { created_at: 'desc' },
    select: { id: true }
  })
  if (!plan) return []

  const versions = await prisma.dietVersion.findMany({
    where: {
      diet_plan_id: plan.id,
      status: { in: ['active', 'superseded'] },
      // A version that had not started yet is not history, it is a plan the
      // athlete had not begun following.
      start_date: asOf ? { not: null, lte: asOf } : { not: null }
    },
    orderBy: { start_date: 'desc' },
    take: limit,
    select: {
      version_number: true,
      start_date: true,
      end_date: true,
      change_note: true,
      total_kcal: true,
      total_protein_g: true,
      total_carbs_g: true,
      total_fat_g: true
    }
  })

  return versions.map(v => ({
    version_number: v.version_number,
    from: v.start_date!.toISOString().substring(0, 10),
    // An end date later than the reference is a fact from the future: at `asOf`
    // this version had not been replaced yet, and it renders as "vigente".
    ...(v.end_date && !(asOf && v.end_date > asOf) && { to: v.end_date.toISOString().substring(0, 10) }),
    ...(v.change_note && { change_note: v.change_note }),
    kcal: v.total_kcal,
    protein_g: v.total_protein_g,
    carbs_g: v.total_carbs_g,
    fat_g: v.total_fat_g
  }))
}

// ── Final summary ──────────────────────────────────────────────────────────────

/**
 * Everything the final-summary task is told about a completed block.
 *
 * **`asOf` is the block's end, and it closes every window here — not just the
 * profile's.** A block owns its rows through a foreign key, and a foreign key
 * carries no date: a workout attached to a finished block weeks afterwards, a
 * diary note written in hindsight, an evaluation run later, a diet published
 * since — each one is dated past the end of the block and each one lets the
 * summary explain how the block went using something that had not happened
 * while it ran. Only the profile was bounded before.
 *
 * Returns null when the mesocycle isn't the caller's; ownership is part of the
 * lookup, as everywhere else.
 */
export async function buildFinalSummaryPayload(
  userId: string,
  mesocycleId: string
): Promise<FinalSummaryPayload | null> {
  const mesocycle = await prisma.mesocycle.findFirst({ where: { id: mesocycleId, user_id: userId } })
  if (!mesocycle) return null

  const now = new Date()
  const asOf = mesocycle.end_date && mesocycle.end_date < now ? mesocycle.end_date : now

  const [athlete, allWorkouts, allEvaluations, allNotes, nutrition, nutritionHistory, liftData] = await Promise.all([
    buildAthleteProfile(userId, { asOf }),
    prisma.workout.findMany({
      where: { user_id: userId, mesocycle_id: mesocycleId, date: { lte: asOf } },
      orderBy: { date: 'asc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true, duration: true }
    }),
    prisma.mesocycleEvaluation.findMany({
      where: { mesocycle_id: mesocycleId, evaluation_date: { lte: asOf } },
      orderBy: { week_number: 'asc' },
      select: { week_number: true, summary: true, volume_trend: true, recommendations: true }
    }),
    prisma.mesocycleNote.findMany({
      where: { mesocycle_id: mesocycleId, date: { lte: asOf } },
      orderBy: { date: 'asc' }
    }),
    buildNutritionSnapshot(userId, { asOf }),
    buildNutritionHistory(userId, 12, asOf),
    buildBlockLiftProgression(userId, mesocycleId, asOf)
  ])

  const totalVolume = allWorkouts.reduce((s, w) => s + Number(w.total_volume ?? 0), 0)
  const workoutsWithRpe = allWorkouts.filter(w => w.rpe_avg)
  const avgRpe = workoutsWithRpe.length
    ? workoutsWithRpe.reduce((s, w) => s + (w.rpe_avg ?? 0), 0) / workoutsWithRpe.length
    : 0

  const durationDays = Math.round(
    ((mesocycle.end_date ? new Date(mesocycle.end_date).getTime() : now.getTime()) -
      new Date(mesocycle.start_date).getTime()) / (24 * 60 * 60 * 1000)
  )

  const firstWorkout = allWorkouts[0]
  const lastWorkout = allWorkouts[allWorkouts.length - 1]

  return {
    task: 'final_summary',
    today: localDayKey(now),
    as_of: localDayKey(asOf),
    athlete,
    mesocycle: {
      name: mesocycle.name,
      ...(mesocycle.goal && { goal: mesocycle.goal }),
      ...(mesocycle.split_description && { split: mesocycle.split_description })
    },
    stats: {
      duration_days: durationDays,
      duration_weeks: Math.round(durationDays / 7),
      total_sessions: allWorkouts.length,
      total_volume_kg: Math.round(totalVolume),
      avg_rpe: parseFloat(avgRpe.toFixed(1))
    },
    ...(firstWorkout && { first_workout: buildWorkoutData(firstWorkout, true) }),
    ...(lastWorkout && lastWorkout !== firstWorkout && { last_workout: buildWorkoutData(lastWorkout, true) }),
    weekly_evaluations: allEvaluations.map(e => ({
      week: e.week_number,
      ...(e.summary && { summary: e.summary }),
      ...(e.volume_trend && { volume_trend: e.volume_trend }),
      ...(e.recommendations && { recommendations: e.recommendations })
    })),
    diary_notes: allNotes.map(n => ({
      date: localDayKey(new Date(n.date)),
      content: n.content
    })),
    ...(nutrition && { nutrition }),
    ...(nutritionHistory.length > 0 && { nutrition_history: nutritionHistory }),
    ...(liftData.lifts.length > 0 && { lift_progression: liftData.lifts }),
    ...(liftData.records.length > 0 && { block_records: liftData.records })
  }
}

/**
 * Weekly training load, so a diet can be judged against the work it has to
 * fuel rather than in isolation.
 */
export async function buildTrainingLoad(
  userId: string,
  weeks = 8,
  asOf?: Date
): Promise<Array<{ week: string; sessions: number; total_volume_kg: number; avg_rpe: number | null }>> {
  const until = asOf ?? new Date()
  const since = new Date(until)
  since.setDate(since.getDate() - weeks * 7)

  const workouts = await prisma.workout.findMany({
    where: { user_id: userId, date: { gte: since, lte: until } },
    orderBy: { date: 'asc' },
    select: { date: true, total_volume: true, rpe_avg: true }
  })

  const byWeek = new Map<string, { volume: number; sessions: number; rpes: number[] }>()
  for (const w of workouts) {
    const key = localWeekKey(new Date(w.date))
    if (!byWeek.has(key)) byWeek.set(key, { volume: 0, sessions: 0, rpes: [] })
    const bucket = byWeek.get(key)!
    bucket.volume += w.total_volume ?? 0
    bucket.sessions += 1
    if (w.rpe_avg != null) bucket.rpes.push(w.rpe_avg)
  }

  return Array.from(byWeek.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, b]) => ({
      week,
      sessions: b.sessions,
      total_volume_kg: Math.round(b.volume),
      avg_rpe: b.rpes.length ? Math.round((b.rpes.reduce((s, r) => s + r, 0) / b.rpes.length) * 10) / 10 : null
    }))
}
