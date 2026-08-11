import type { PlannedSessionInput, WeekInput } from './plan-service'

/**
 * Deterministic validation of a generated mesocycle.
 *
 * **The prompt is not a constraint.** It is a request the model usually honours,
 * and "usually" is not good enough for something that becomes rows in the
 * athlete's plan, gets compared against their sessions and is pushed into their
 * Hevy account. Everything the prompt asks for is re-checked here, in code, on
 * the parsed object — so the guarantee holds no matter what the model returns
 * or which model it is.
 *
 * Three outcomes, and the split between them is the whole design:
 *
 *  - **Fatal** — the object is not a plan (no sessions, a session with no
 *    exercises, an exercise with no name). Nothing is returned and nothing is
 *    persisted: there is no honest way to repair a session whose contents are
 *    missing, and a half-plan rendered in the form is worse than an error,
 *    because it looks like a plan.
 *  - **Repaired** — a value that is out of range but whose intent is
 *    unambiguous: 0 sets, reps the wrong way round, an RIR of 12. Clamped, and
 *    every repair is reported. Discarding a whole generation over a typo in one
 *    field would cost minutes and money to fix by hand what one `Math.min` fixes
 *    here.
 *  - **Warning** — the plan is valid but departs from what was asked (a session
 *    fewer than the days requested, no deload in a 6-week block) or lost
 *    something on the way (an exercise id that never came from the catalogue).
 *    The athlete decides; they are shown the plan before it is saved.
 *
 * **`exercise_template_id` is whitelisted, not merely checked.** An id survives
 * only if the model actually received it from `search_exercise_templates`
 * during this generation *and* it exists in the catalogue. A plausible-looking
 * id that came from the model's own head is dropped: `savePlan` would ignore it
 * anyway, but silently, and the athlete would find out at push time.
 */

/** A generated plan, after validation: safe to render and to hand to savePlan. */
export interface ValidatedPlan {
  name: string
  goal: string | null
  notes: string | null
  weeks: WeekInput[]
  sessions: PlannedSessionInput[]
  /** Values that were out of range and were clamped. */
  repairs: string[]
  /** Departures from the request, and ids that were dropped. */
  warnings: string[]
}

export interface PlanValidationOptions {
  durationWeeks: number
  daysPerWeek: number
  /**
   * Ids the model was actually given by `search_exercise_templates` in this
   * generation. Empty means "no lookups happened", and every id is then
   * dropped — which is the correct reading: none of them can have come from
   * the catalogue.
   */
  allowedTemplateIds: Set<string>
  /** Of those, the ones that still exist in the catalogue. */
  knownTemplateIds: Set<string>
}

/** Ranges. Wide enough for any real prescription, narrow enough to catch nonsense. */
const LIMITS = {
  sets: { min: 1, max: 15, fallback: 3 },
  reps: { min: 1, max: 60 },
  rir: { min: 0, max: 6 },
  rest: { min: 0, max: 900 },
  multiplier: { min: 0.2, max: 1.5 },
  /** A block longer than this is not a mesocycle. */
  weeks: { min: 1, max: 16 },
  /** Above this, the last week isn't a deload — a real one backs volume off. */
  deloadMultiplier: 0.6
} as const

/** Throws a 502 the endpoint can surface verbatim. */
function reject(reason: string): never {
  throw createError({
    statusCode: 502,
    statusMessage: `La IA devolvió un plan no válido: ${reason}. Inténtalo de nuevo.`
  })
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Number within [min,max], or null when it isn't a number at all. */
function clamp(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  if (!isFiniteNumber(n)) return null
  return Math.min(max, Math.max(min, n))
}

const text = (value: unknown): string | null => {
  const s = typeof value === 'string' ? value.trim() : ''
  return s ? s : null
}

export function validateGeneratedMesocycle(raw: any, options: PlanValidationOptions): ValidatedPlan {
  const repairs: string[] = []
  const warnings: string[] = []

  if (!raw || typeof raw !== 'object') reject('la respuesta no es un objeto')

  const rawSessions = Array.isArray(raw.sessions) ? raw.sessions : []
  if (!rawSessions.length) reject('no trae ninguna sesión de entrenamiento')

  // ── Sessions ────────────────────────────────────────────────────────────────
  const usedWeekdays = new Map<number, string>()
  const sessions: PlannedSessionInput[] = rawSessions.map((s: any, index: number) => {
    if (!s || typeof s !== 'object') reject(`la sesión ${index + 1} no es un objeto`)

    const name = text(s.name)
    if (!name) reject(`la sesión ${index + 1} no tiene nombre`)

    const rawExercises = Array.isArray(s.exercises) ? s.exercises : []
    if (!rawExercises.length) reject(`la sesión "${name}" no tiene ejercicios`)

    let dayOfWeek = clamp(s.day_of_week, 1, 7)
    if (dayOfWeek != null) {
      dayOfWeek = Math.round(dayOfWeek)
      const already = usedWeekdays.get(dayOfWeek)
      if (already) {
        // Kept rather than nulled: two sessions on one day is unusual but
        // trainable, and blanking the day would hide the session from the
        // "what's next" logic entirely. The athlete is told instead.
        warnings.push(`"${name}" comparte día de la semana con "${already}".`)
      } else {
        usedWeekdays.set(dayOfWeek, name)
      }
    }

    const exercises = rawExercises.map((e: any, exIndex: number) => {
      if (!e || typeof e !== 'object') reject(`el ejercicio ${exIndex + 1} de "${name}" no es un objeto`)
      const exName = text(e.name)
      if (!exName) reject(`un ejercicio de "${name}" no tiene nombre`)

      // Whitelist: obtained from the catalogue search in this generation, and
      // still in the catalogue.
      const proposedId = text(e.exercise_template_id)
      let templateId: string | null = null
      if (proposedId) {
        if (!options.allowedTemplateIds.has(proposedId)) {
          warnings.push(`"${exName}": id de ejercicio descartado, no salió de la búsqueda en el catálogo.`)
        } else if (!options.knownTemplateIds.has(proposedId)) {
          warnings.push(`"${exName}": id de ejercicio descartado, ya no existe en el catálogo.`)
        } else {
          templateId = proposedId
        }
      }

      let sets = clamp(e.target_sets, LIMITS.sets.min, LIMITS.sets.max)
      if (sets == null) {
        sets = LIMITS.sets.fallback
        repairs.push(`"${exName}": sin series indicadas, se ponen ${sets}.`)
      } else if (isFiniteNumber(e.target_sets) && e.target_sets !== sets) {
        repairs.push(`"${exName}": ${e.target_sets} series ajustadas a ${sets}.`)
      }
      sets = Math.round(sets)

      let repMin = clamp(e.rep_min, LIMITS.reps.min, LIMITS.reps.max)
      let repMax = clamp(e.rep_max, LIMITS.reps.min, LIMITS.reps.max)
      // One bound alone is a fixed rep target, not an error.
      if (repMin == null && repMax != null) repMin = repMax
      if (repMax == null && repMin != null) repMax = repMin
      if (repMin != null && repMax != null && repMin > repMax) {
        ;[repMin, repMax] = [repMax, repMin]
        repairs.push(`"${exName}": rango de repeticiones invertido, corregido a ${repMin}-${repMax}.`)
      }

      const rir = clamp(e.target_rir, LIMITS.rir.min, LIMITS.rir.max)
      if (rir != null && isFiniteNumber(e.target_rir) && e.target_rir !== rir) {
        repairs.push(`"${exName}": RIR ${e.target_rir} ajustado a ${rir}.`)
      }

      const rest = clamp(e.rest_seconds, LIMITS.rest.min, LIMITS.rest.max)

      return {
        ...(templateId && { exercise_template_id: templateId }),
        name: exName,
        target_sets: sets,
        rep_min: repMin != null ? Math.round(repMin) : null,
        rep_max: repMax != null ? Math.round(repMax) : null,
        target_rir: rir != null ? Math.round(rir) : null,
        rest_seconds: rest != null ? Math.round(rest) : null,
        progression_scheme: text(e.progression_scheme) ?? 'double_progression',
        notes: text(e.notes)
      }
    })

    return {
      name,
      day_of_week: dayOfWeek,
      notes: text(s.notes),
      exercises
    }
  })

  if (sessions.length !== options.daysPerWeek) {
    warnings.push(`Se pidieron ${options.daysPerWeek} sesiones por semana y el plan trae ${sessions.length}.`)
  }

  // ── Weeks ───────────────────────────────────────────────────────────────────
  const duration = clamp(options.durationWeeks, LIMITS.weeks.min, LIMITS.weeks.max) ?? LIMITS.weeks.min
  const rawWeeks: any[] = Array.isArray(raw.weeks) ? raw.weeks : []

  const byNumber = new Map<number, any>()
  for (const w of rawWeeks) {
    const number = clamp(w?.week_number, 1, duration)
    if (number == null) continue
    const rounded = Math.round(number)
    // First one wins: a duplicated week number is a repeat, and picking the
    // later one would silently discard the earlier week's programming.
    if (!byNumber.has(rounded)) byNumber.set(rounded, w)
  }
  if (rawWeeks.length > byNumber.size) {
    repairs.push(`Se descartaron ${rawWeeks.length - byNumber.size} semana(s) duplicadas o fuera del bloque.`)
  }

  const weeks: WeekInput[] = []
  for (let number = 1; number <= duration; number++) {
    const w = byNumber.get(number)
    if (!w) {
      // A neutral row, not invented programming: no RIR override and no volume
      // change is exactly what "this week was not specified" means.
      weeks.push({ week_number: number, is_deload: false, target_rir: null, volume_multiplier: 1, notes: null })
      repairs.push(`Faltaba la semana ${number}; se añade sin ajustes de volumen ni RIR.`)
      continue
    }
    const multiplier = clamp(w.volume_multiplier, LIMITS.multiplier.min, LIMITS.multiplier.max)
    if (multiplier != null && isFiniteNumber(w.volume_multiplier) && w.volume_multiplier !== multiplier) {
      repairs.push(`Semana ${number}: multiplicador de volumen ${w.volume_multiplier} ajustado a ${multiplier}.`)
    }
    const rir = clamp(w.target_rir, LIMITS.rir.min, LIMITS.rir.max)
    weeks.push({
      week_number: number,
      is_deload: w.is_deload === true,
      target_rir: rir != null ? Math.round(rir) : null,
      volume_multiplier: multiplier ?? 1,
      notes: text(w.notes)
    })
  }

  // A block of four weeks or more that never backs off isn't periodised, and
  // the athlete is the one who has to live with that — so it is said, not fixed.
  if (duration >= 4) {
    const last = weeks[weeks.length - 1]
    if (!last.is_deload) {
      warnings.push(`La última semana (${last.week_number}) no está marcada como descarga en un bloque de ${duration} semanas.`)
    } else if ((last.volume_multiplier ?? 1) > LIMITS.deloadMultiplier) {
      warnings.push(`La semana de descarga mantiene el ${Math.round((last.volume_multiplier ?? 1) * 100)} % del volumen.`)
    }
  }

  const rirByWeek = weeks.map(w => w.target_rir).filter((r): r is number => r != null)
  if (rirByWeek.length >= 2 && rirByWeek.some((r, i) => i > 0 && r > rirByWeek[i - 1] && !weeks[i].is_deload)) {
    warnings.push('El RIR objetivo no desciende de forma continua a lo largo del bloque.')
  }

  return {
    name: text(raw.name) ?? 'Mesociclo generado',
    goal: text(raw.goal),
    notes: text(raw.notes),
    weeks,
    sessions,
    repairs,
    warnings
  }
}
