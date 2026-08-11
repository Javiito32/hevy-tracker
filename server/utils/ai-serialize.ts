import type {
  AthleteProfile,
  BodyMeasurements,
  CompoundLift,
  Exercise,
  FinalSummaryPayload,
  MesocycleFeedbackPayload,
  NutritionAnalysisPayload,
  NutritionHistoryEntry,
  NutritionSnapshot,
  NutritionTargetsPayload,
  SetDetail,
  WeekEvaluationPayload,
  WeeklyEvaluation,
  Workout,
  WorkoutAnalysisPayload
} from './ai-payload'

/**
 * The last mile before the model: typed domain objects in, compact text out.
 *
 * **Nothing upstream of this file knows the model exists.** The builders in
 * `ai-payload.ts` return typed structures, the endpoints compose them, and only
 * here do they become the string that is billed — which is what keeps token
 * pressure out of the domain layer. Change how a figure is presented here;
 * change what a figure *is* over there.
 *
 * Why text and not JSON. The stateless tasks used to send
 * `JSON.stringify(payload, null, 2)`, and a workout with six exercises spent
 * roughly half its tokens on punctuation, indentation and the same eight field
 * names repeated once per set. A row in a table names its columns once. Measured
 * on a real 8-exercise session with full set detail, the same information costs
 * ~55 % fewer tokens as a table than as pretty-printed JSON, and the figures
 * themselves are unchanged.
 *
 * What stays JSON, and why:
 *  - **tool arguments** — the model has to emit them, and a schema it can be
 *    validated against is worth more than the tokens it costs;
 *  - **structured outputs** (`ai-generate`, `ai-targets`) — code parses them;
 *  - anything with genuinely recursive structure. Training data has none: a
 *    workout is a list of exercises and an exercise is a list of sets, which is
 *    two tables.
 *
 * Legibility over compression. No dictionary of one-letter keys, no positional
 * encodings the model has to be taught: every table names its columns in the
 * language of the prompt, and the only abbreviations are the three set markers
 * below, which the grounding block spells out.
 */

// ── Primitives ─────────────────────────────────────────────────────────────────

/** '—' everywhere a value is genuinely absent. Never 0: they are not the same. */
export const NONE = '—'

/**
 * Trims the trailing zeros a fixed-decimal conversion leaves behind: 82.40 →
 * 82.4, 100.0 → 100.
 *
 * The guard matters. Stripping zeros off a string with no decimal point at all
 * turns `num(100, 0)` into "1" — which is what it did, and it reached a food
 * portion before a test caught it.
 */
export function num(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return NONE
  const fixed = value.toFixed(decimals)
  if (!fixed.includes('.')) return fixed
  return fixed.replace(/\.?0+$/, '') || '0'
}

/** Thousands separator omitted on purpose — it tokenises worse than the digits. */
export function int(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NONE
  return String(Math.round(value))
}

/**
 * A table as `header | header` + one line per row.
 *
 * Columns whose every cell is empty are dropped: a body-measurement table has
 * twenty possible columns and a given athlete records four, and eighteen empty
 * cells per row is the JSON problem again in a different shape.
 */
export function table(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  if (!rows.length) return ''
  const cells = rows.map(r => headers.map((_, i) => {
    const v = r[i]
    return v == null || v === '' ? '' : String(v)
  }))
  const keep = headers.map((_, i) => cells.some(row => row[i] !== '' && row[i] !== NONE))
  const line = (values: string[]) => values.filter((_, i) => keep[i]).join(' | ')
  return [line(headers), ...cells.map(line)].join('\n')
}

/** `## TITLE` + body, or nothing at all when there is no body. */
export function section(title: string, body: string | null | undefined): string {
  const text = (body ?? '').trim()
  if (!text) return ''
  return `## ${title}\n${text}`
}

/** Joins the sections that produced content, blank line between. */
export function document(...parts: Array<string | null | undefined>): string {
  return parts.map(p => (p ?? '').trim()).filter(Boolean).join('\n\n')
}

const iso = (date: Date | string): string =>
  (date instanceof Date ? date : new Date(date)).toISOString().substring(0, 10)

// ── Training ───────────────────────────────────────────────────────────────────

/**
 * Set markers. A set with no marker is a normal working set — the common case
 * costs no characters at all, which is the same reason `SetDetail.type` is only
 * emitted when it isn't 'normal'.
 */
const SET_MARKER: Record<string, string> = { warmup: 'c', dropset: 'd', failure: 'f' }

/** `100×8@8` — weight × reps @ RPE, with the marker suffixed when there is one. */
export function formatSet(s: SetDetail): string {
  const marker = s.type ? SET_MARKER[s.type] ?? s.type : ''
  if (s.duration_s != null || s.distance_m != null) {
    const parts: string[] = []
    if (s.distance_m != null) parts.push(`${int(s.distance_m)}m`)
    if (s.duration_s != null) parts.push(`${int(s.duration_s)}s`)
    return parts.join('/') + marker
  }
  const weight = s.weight_kg != null ? num(s.weight_kg) : ''
  const reps = s.reps != null ? String(s.reps) : ''
  const load = weight && reps ? `${weight}×${reps}` : weight || reps || NONE
  return `${load}${s.rpe != null ? `@${num(s.rpe)}` : ''}${marker}`
}

function exerciseRow(ex: Exercise, withSets: boolean): Array<string | null> {
  return [
    ex.name,
    String(ex.sets),
    ex.total_volume_kg != null ? int(ex.total_volume_kg) : null,
    ex.estimated_1rm_kg != null ? num(ex.estimated_1rm_kg) : null,
    withSets && ex.sets_detail?.length ? ex.sets_detail.map(formatSet).join(' · ') : null
  ]
}

/** Header line of a session: everything that isn't a per-exercise figure. */
function workoutHeader(w: Workout): string {
  const parts = [w.date, w.name]
  if (w.duration_min) parts.push(`${w.duration_min} min`)
  parts.push(`vol ${int(w.total_volume_kg)} kg`)
  if (w.rpe_avg != null) parts.push(`RPE ${num(w.rpe_avg)}`)
  return parts.join(' · ')
}

export interface WorkoutFormat {
  /** 'sets' spells out every series; 'exercises' stops at the per-exercise row. */
  detail?: 'sets' | 'exercises'
}

/** One session: a header line, then one row per exercise. */
export function serializeWorkout(w: Workout, options: WorkoutFormat = {}): string {
  const withSets = (options.detail ?? 'sets') === 'sets'
  const lines = [`### ${workoutHeader(w)}`]
  if (w.notes) lines.push(`nota del deportista: ${w.notes}`)
  if (w.exercises?.length) {
    lines.push(table(
      ['ejercicio', 'series', 'vol_kg', 'e1RM_kg', 'detalle (peso×reps@RPE)'],
      w.exercises.map(ex => exerciseRow(ex, withSets))
    ))
  }
  return lines.join('\n')
}

export function serializeWorkouts(workouts: Workout[], options: WorkoutFormat = {}): string {
  return workouts.map(w => serializeWorkout(w, options)).join('\n\n')
}

/**
 * Many sessions as a single table, one line each.
 *
 * For the lists whose job is the shape of a period rather than the content of a
 * session — previous weeks in an evaluation, recent sessions as a baseline.
 */
export function serializeWorkoutLines(workouts: Array<Omit<Workout, 'exercises'>>): string {
  return table(
    ['fecha', 'sesión', 'vol_kg', 'RPE', 'nota'],
    workouts.map(w => [w.date, w.name, int(w.total_volume_kg), w.rpe_avg != null ? num(w.rpe_avg) : null, w.notes ?? null])
  )
}

export function serializeCompoundLifts(lifts: CompoundLift[]): string {
  return table(
    ['ejercicio', 'e1RM_kg', 'fecha'],
    lifts.map(l => [l.exercise, num(l.estimated_1rm_kg), l.date])
  )
}

export function serializeEvaluations(evaluations: WeeklyEvaluation[]): string {
  return evaluations.map(e => {
    const lines = [`semana ${e.week}${e.volume_trend ? ` · volumen ${e.volume_trend}` : ''}`]
    if (e.summary) lines.push(`  resumen: ${e.summary}`)
    if (e.recommendations) lines.push(`  recomendaciones: ${e.recommendations}`)
    return lines.join('\n')
  }).join('\n')
}

export function serializeNotes(notes: Array<{ date: string; content: string }>): string {
  return notes.map(n => `[${n.date}] ${n.content}`).join('\n')
}

export function serializeMuscleVolume(
  rows: Array<{ muscle: string; label: string; avg_weekly_sets: number; verdict: string; mev?: number; mav?: number; mrv?: number }>
): string {
  return table(
    ['grupo', 'series/sem', 'veredicto', 'MEV', 'MAV', 'MRV'],
    rows.map(r => [r.label || r.muscle, num(r.avg_weekly_sets), r.verdict, r.mev ?? null, r.mav ?? null, r.mrv ?? null])
  )
}

export function serializeTrainingLoad(
  weeks: Array<{ week: string; sessions: number; total_volume_kg: number; avg_rpe: number | null }>
): string {
  return table(
    ['semana', 'sesiones', 'vol_kg', 'RPE medio'],
    weeks.map(w => [w.week, w.sessions, int(w.total_volume_kg), w.avg_rpe != null ? num(w.avg_rpe) : null])
  )
}

// ── Athlete ────────────────────────────────────────────────────────────────────

const MEASUREMENT_COLUMNS: Array<[keyof BodyMeasurements, string]> = [
  ['body_fat_pct', 'grasa%'],
  ['lean_mass_kg', 'magra_kg'],
  ['neck_cm', 'cuello'],
  ['shoulder_cm', 'hombros'],
  ['chest_cm', 'pecho'],
  ['waist_cm', 'cintura'],
  ['abdomen_cm', 'abdomen'],
  ['hips_cm', 'caderas'],
  ['left_bicep_cm', 'bíceps_i'],
  ['right_bicep_cm', 'bíceps_d'],
  ['left_bicep_relaxed_cm', 'bíceps_i_rel'],
  ['right_bicep_relaxed_cm', 'bíceps_d_rel'],
  ['left_forearm_cm', 'antebrazo_i'],
  ['right_forearm_cm', 'antebrazo_d'],
  ['left_thigh_cm', 'muslo_i'],
  ['right_thigh_cm', 'muslo_d'],
  ['left_calf_cm', 'gemelo_i'],
  ['right_calf_cm', 'gemelo_d'],
  ['hrv', 'HRV'],
  ['resting_hr', 'FC_reposo']
]

/**
 * The athlete.
 *
 * **Injuries are printed with a hard-constraint heading**, not as one more
 * line among the measurements: every task that can prescribe an exercise now
 * receives this block, and the difference between "context" and "constraint"
 * is the whole reason it travels.
 */
export function serializeAthlete(a: AthleteProfile): string {
  const parts: string[] = []

  const identity = [
    a.name,
    a.sex === 'male' ? 'H' : a.sex === 'female' ? 'M' : a.sex,
    a.age_years != null ? `${a.age_years} años` : null,
    a.height_cm != null ? `${num(a.height_cm, 0)} cm` : null
  ].filter(Boolean).join(' · ')
  if (identity) parts.push(identity)

  if (a.weight_history?.length) {
    parts.push('peso (media por semana):\n' + table(
      ['semana', 'kg', 'medidas'],
      a.weight_history.map(w => [w.week, num(w.avg_kg), w.samples])
    ))
  }

  const snapshots: Array<[string, BodyMeasurements | undefined]> = [
    ['actual', a.body_measurements?.current],
    ['~1 mes antes', a.body_measurements?.one_month_ago],
    ['~3 meses antes', a.body_measurements?.three_months_ago]
  ]
  const present = snapshots.filter(([, m]) => m) as Array<[string, BodyMeasurements]>
  if (present.length) {
    parts.push('medidas corporales:\n' + table(
      ['momento', 'fecha', ...MEASUREMENT_COLUMNS.map(([, label]) => label)],
      present.map(([label, m]) => [
        label,
        m.date,
        ...MEASUREMENT_COLUMNS.map(([key]) => {
          const value = m[key]
          return typeof value === 'number' ? num(value) : null
        })
      ])
    ))
  }

  if (a.injuries_limitations) {
    parts.push(`LESIONES / LIMITACIONES (restricción dura, respétala en cualquier recomendación de ejercicios):\n${a.injuries_limitations}`)
  }

  if (a.active_notes?.length) {
    parts.push('notas recordadas sobre el deportista:\n' + a.active_notes.map(n => `- ${n}`).join('\n'))
  }

  return parts.join('\n\n') || 'Sin datos de perfil registrados.'
}

// ── Nutrition ──────────────────────────────────────────────────────────────────

const macroLine = (n: { kcal?: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null }): string =>
  `${int(n.kcal)} kcal · P ${int(n.protein_g)} g · C ${int(n.carbs_g)} g · G ${int(n.fat_g)} g`

/**
 * The planned diet.
 *
 * Keeps every distinction the JSON payload drew, because each of them was put
 * there to stop a specific wrong reading: the mean is labelled with its
 * denominator, partial micronutrients are labelled as lower bounds, and an
 * omitted menu says so instead of looking like a diet with no food in it.
 */
export function serializeNutrition(n: NutritionSnapshot): string {
  const lines: string[] = [
    `plan: ${n.plan_name}${n.goal ? ` (objetivo: ${n.goal})` : ''} · versión ${n.version_number}${n.in_force_since ? ` vigente desde ${n.in_force_since}` : ''}`,
    'ES UN PLAN, NO UN REGISTRO DE INGESTA.',
    `media de un día planificado (${n.planned_days_per_week ?? NONE} de 7${n.planned_weekdays?.length ? `: ${n.planned_weekdays.join(', ')}` : ''}): ` +
      macroLine({ kcal: n.daily_kcal, protein_g: n.daily_protein_g, carbs_g: n.daily_carbs_g, fat_g: n.daily_fat_g }) +
      (n.protein_g_per_kg != null ? ` · ${num(n.protein_g_per_kg)} g proteína/kg` : '')
  ]

  if (n.macro_split_pct) {
    lines.push(`reparto: P ${int(n.macro_split_pct.protein)}% · C ${int(n.macro_split_pct.carbs)}% · G ${int(n.macro_split_pct.fat)}%`)
  }
  if (n.targets && Object.values(n.targets).some(v => v != null)) {
    lines.push(`objetivo marcado: ${macroLine(n.targets)}`)
  }
  if (n.training_weekdays?.length) {
    lines.push(`días de entrenamiento (del mesociclo activo): ${n.training_weekdays.join(', ')}`)
  }

  if (n.days?.length) {
    lines.push('por día (días idénticos agrupados):\n' + table(
      ['días', 'kcal', 'P_g', 'C_g', 'G_g'],
      n.days.map(d => [d.weekdays.join(', '), int(d.kcal), int(d.protein_g), int(d.carbs_g), int(d.fat_g)])
    ))
  }

  if (n.targets_by_weekday?.length) {
    lines.push('objetivos que se salen del general:\n' + table(
      ['día', 'kcal', 'P_g', 'C_g', 'G_g'],
      n.targets_by_weekday.map(t => [t.weekday, int(t.kcal), int(t.protein_g), int(t.carbs_g), int(t.fat_g)])
    ))
  }

  if (n.micronutrients && Object.keys(n.micronutrients).length) {
    const entries = Object.entries(n.micronutrients).map(([key, value]) => {
      const partial = n.micronutrients_partial?.[key]
      return `${key} ${num(value)}${partial ? ` (cota mínima: ${partial})` : ''}`
    })
    lines.push('micronutrientes conocidos (los ausentes faltan en la base de alimentos, NO son cero):\n' + entries.join(' · '))
  }

  if (n.meals_by_day?.length) {
    lines.push('menú por día:\n' + n.meals_by_day.map(g =>
      `- ${g.weekdays.join(', ')}:\n` + (g.meals.length
        ? g.meals.map(m => `    · ${m.name}${m.time_of_day ? ` (${m.time_of_day})` : ''}: ` +
            m.foods.map(f => `${f.name} ${num(f.quantity_g, 0)} g`).join(', ')).join('\n')
        : '    (sin comidas planificadas — no es un día de 0 kcal, está sin planificar)')
    ).join('\n'))
  } else if (n.meals_omitted) {
    lines.push('MENÚ NO INCLUIDO en estos datos: solo energía y macros. No enumeres comidas ni alimentos.')
  } else if (n.meals?.length) {
    lines.push(
      `menú${n.meals_apply_to?.length ? ` (aplica a: ${n.meals_apply_to.join(', ')})` : ''}:\n` +
      n.meals.map(m => `- ${m.name}${m.time_of_day ? ` (${m.time_of_day})` : ''}: ` +
        m.foods.map(f => `${f.name} ${num(f.quantity_g, 0)} g`).join(', ')).join('\n')
    )
    if (n.meals_other_days_omitted) {
      lines.push('El resto de días tienen otro menú que NO está en estos datos.')
    }
  }

  return lines.join('\n')
}

export function serializeNutritionHistory(history: NutritionHistoryEntry[]): string {
  return table(
    ['versión', 'desde', 'hasta', 'kcal', 'P_g', 'C_g', 'G_g', 'nota de cambio'],
    history.map(h => [h.version_number, h.from, h.to ?? 'vigente', int(h.kcal), int(h.protein_g), int(h.carbs_g), int(h.fat_g), h.change_note ?? null])
  )
}

// ── Task documents ─────────────────────────────────────────────────────────────

/**
 * The user message of a stateless task.
 *
 * One `## SECTION` per block, named by what it is rather than by a field path,
 * because that is how the prompts now refer to them. Absent blocks produce no
 * heading at all: a prompt that never sees `## DIETA` says nothing about diet,
 * which is exactly what an absent `nutrition` key used to achieve.
 */
export function renderTaskDocument(
  task: string,
  today: string,
  sections: Array<[string, string | null | undefined]>
): string {
  return document(
    `TAREA: ${task}\nHOY: ${today}`,
    ...sections.map(([title, body]) => section(title, body))
  )
}

const dateOf = (value: Date | string): string => iso(value)
export { dateOf as isoDate }

/**
 * One renderer per stateless task, taking the same typed payload the endpoints
 * already build.
 *
 * The payload types in `ai-payload.ts` stay exactly as they were — they are the
 * app's normalised view of a task's data, and they are what the endpoint
 * composes, what a test asserts on and what a future non-text consumer would
 * read. These functions are the only place that knows a language model is at
 * the other end.
 */

const mesocycleLine = (m: { name: string; goal?: string; split?: string; sessions_per_week?: number }): string =>
  [
    `bloque: ${m.name}`,
    m.goal ? `objetivo: ${m.goal}` : null,
    m.sessions_per_week != null ? `sesiones/semana objetivo: ${m.sessions_per_week}` : null,
    m.split ? `split (texto libre):\n${m.split}` : null
  ].filter(Boolean).join('\n')

export function renderWorkoutAnalysis(p: WorkoutAnalysisPayload): string {
  return renderTaskDocument('analizar entrenamiento', p.today, [
    // Said in the document, not only in the prompt: the profile is as of the
    // session's own date, and a model that assumed "today" would narrate the
    // athlete's current weight into a session from March.
    ['PERFIL (a fecha de la sesión analizada)', serializeAthlete(p.athlete)],
    ['MESOCICLO', p.active_mesocycle ? mesocycleLine(p.active_mesocycle) : null],
    ['ENTRENAMIENTO', serializeWorkout(p.workout, { detail: 'sets' })],
    ['SESIONES ANTERIORES COMPARABLES', p.historical_reference?.length
      ? serializeWorkouts(p.historical_reference, { detail: 'sets' })
      : null]
  ])
}

export function renderWeekEvaluation(p: WeekEvaluationPayload): string {
  const w = p.current_week
  const head = [
    `semana ${w.number} del bloque · ${w.from} → ${w.to}`,
    w.in_progress ? `EN CURSO · quedan ${w.days_remaining ?? NONE} días` : 'semana cerrada',
    `sesiones: ${w.sessions_completed}${w.sessions_target != null ? ` de ${w.sessions_target}` : ''}`,
    `volumen: ${int(w.total_volume_kg)} kg · frente a la semana anterior: ${w.volume_vs_previous_kg >= 0 ? '+' : ''}${int(w.volume_vs_previous_kg)} kg (${w.volume_trend})`
  ].join('\n')

  return renderTaskDocument('evaluar semana', p.today, [
    // Dated in the heading, like the workout analysis: the profile is the one
    // the athlete had at the end of the week being judged, and a model reading
    // a bare "PERFIL" narrates it as today's.
    [`PERFIL (a ${w.in_progress ? 'día de hoy' : `fecha de ${w.to}, fin de la semana evaluada`})`, serializeAthlete(p.athlete)],
    ['MESOCICLO', mesocycleLine(p.mesocycle)],
    ['SEMANA ACTUAL', `${head}\n\n${serializeWorkouts(w.workouts, { detail: 'sets' })}`],
    ['NOTAS DE ESTA SEMANA', w.athlete_notes.length ? serializeNotes(w.athlete_notes) : null],
    ['SEMANAS PREVIAS', p.previous_weeks.length
      ? p.previous_weeks.map(pw =>
          `semana ${pw.number} · ${pw.from} → ${pw.to} · ${int(pw.total_volume_kg)} kg\n${serializeWorkoutLines(pw.workouts)}`
        ).join('\n\n')
      : null],
    ['NOTAS ANTERIORES', p.earlier_notes?.length ? serializeNotes(p.earlier_notes) : null],
    ['EVALUACIONES PREVIAS', p.previous_evaluations.length ? serializeEvaluations(p.previous_evaluations) : null],
    ['DIETA', p.nutrition ? serializeNutrition(p.nutrition) : null]
  ])
}

export function renderFinalSummary(p: FinalSummaryPayload): string {
  const stats = [
    `duración: ${p.stats.duration_days} días (${p.stats.duration_weeks} semanas)`,
    `sesiones: ${p.stats.total_sessions}`,
    `volumen total: ${int(p.stats.total_volume_kg)} kg`,
    `RPE medio: ${num(p.stats.avg_rpe)}`
  ].join('\n')

  return renderTaskDocument('resumen final de mesociclo', p.today, [
    [`PERFIL (a fecha de ${p.as_of ?? 'hoy'})`, serializeAthlete(p.athlete)],
    ['MESOCICLO', mesocycleLine(p.mesocycle)],
    ['ESTADÍSTICAS DEL BLOQUE', stats],
    ['PRIMERA SESIÓN', p.first_workout ? serializeWorkout(p.first_workout, { detail: 'sets' }) : null],
    ['ÚLTIMA SESIÓN', p.last_workout ? serializeWorkout(p.last_workout, { detail: 'sets' }) : null],
    ['EVALUACIONES SEMANALES', p.weekly_evaluations.length ? serializeEvaluations(p.weekly_evaluations) : null],
    ['DIARIO DEL BLOQUE', p.diary_notes.length ? serializeNotes(p.diary_notes) : null],
    ['DIETA', p.nutrition ? serializeNutrition(p.nutrition) : null],
    ['HISTORIAL DE DIETA', p.nutrition_history?.length ? serializeNutritionHistory(p.nutrition_history) : null]
  ])
}

export function renderMesocycleFeedback(p: MesocycleFeedbackPayload): string {
  const plan = [
    p.plan.name ? `nombre: ${p.plan.name}` : null,
    p.plan.goal ? `objetivo: ${p.plan.goal}` : null,
    p.plan.duration_weeks != null ? `duración: ${p.plan.duration_weeks} semanas` : null,
    p.plan.sessions_per_week != null ? `sesiones/semana: ${p.plan.sessions_per_week}` : null,
    p.plan.split_description ? `split (texto libre, puede no detallar series):\n${p.plan.split_description}` : null,
    p.plan.notes ? `notas: ${p.plan.notes}` : null
  ].filter(Boolean).join('\n')

  const baseline = p.baseline_mesocycle
    ? [
        mesocycleLine(p.baseline_mesocycle),
        p.baseline_mesocycle.duration_weeks != null ? `duración: ${p.baseline_mesocycle.duration_weeks} semanas` : null,
        p.baseline_mesocycle.weekly_progressions?.length
          ? `progresión semanal:\n${serializeEvaluations(p.baseline_mesocycle.weekly_progressions)}`
          : null
      ].filter(Boolean).join('\n')
    : null

  return renderTaskDocument('feedback de plan', p.today, [
    ['PERFIL', serializeAthlete(p.athlete)],
    ['PLAN PROPUESTO', plan || 'El deportista no ha escrito nada todavía.'],
    ['BLOQUE ANTERIOR (LÍNEA BASE)', baseline],
    ['ENTRENOS RECIENTES', p.recent_workouts.length ? serializeWorkoutLines(p.recent_workouts) : null],
    ['DIETA', p.nutrition ? serializeNutrition(p.nutrition) : null]
  ])
}

export function renderNutritionAnalysis(p: NutritionAnalysisPayload): string {
  return renderTaskDocument('analizar dieta', p.today, [
    ['PERFIL', serializeAthlete(p.athlete)],
    ['MESOCICLO', p.active_mesocycle ? mesocycleLine(p.active_mesocycle) : null],
    ['DIETA', serializeNutrition(p.nutrition)],
    ['HISTORIAL DE DIETA', p.nutrition_history.length ? serializeNutritionHistory(p.nutrition_history) : null],
    ['CARGA DE ENTRENAMIENTO', p.training_load.length ? serializeTrainingLoad(p.training_load) : null]
  ])
}

export function renderNutritionTargets(p: NutritionTargetsPayload): string {
  const request = [
    `objetivo: ${p.request.goal}`,
    p.request.rate_kg_per_week != null ? `ritmo deseado: ${num(p.request.rate_kg_per_week, 2)} kg/semana` : null,
    p.request.notes ? `notas del usuario: ${p.request.notes}` : null
  ].filter(Boolean).join('\n')

  return renderTaskDocument('objetivos nutricionales', p.today, [
    ['PETICIÓN', request],
    ['PERFIL', serializeAthlete(p.athlete)],
    ['DIETA ACTUAL', p.current_nutrition ? serializeNutrition(p.current_nutrition) : null],
    ['HISTORIAL DE DIETA', p.nutrition_history.length ? serializeNutritionHistory(p.nutrition_history) : null],
    ['CARGA DE ENTRENAMIENTO', p.training_load.length ? serializeTrainingLoad(p.training_load) : null]
  ])
}
