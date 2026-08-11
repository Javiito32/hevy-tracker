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
 *
 *    **Quantities are clamped; identifiers are discarded.** A week number and a
 *    weekday name a position, and there is no such thing as the nearest legal
 *    position: clamping `week_number: 0` to 1 does not repair the week, it
 *    overwrites the real week 1 with it, and `week_number: 99` overwrites the
 *    deload. Out-of-range identifiers are dropped and reported — see
 *    `identifier()` — and a week left missing is filled neutral, which is the
 *    one honest reading of "unspecified".
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

/** The value as a number, or null when it isn't one. No range applied. */
function toNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value
  return isFiniteNumber(n) ? n : null
}

/** Number within [min,max], or null when it isn't a number at all. */
function clamp(value: unknown, min: number, max: number): number | null {
  const n = toNumber(value)
  if (n === null) return null
  return Math.min(max, Math.max(min, n))
}

/**
 * An **identifier** in [min,max], or null.
 *
 * The difference from `clamp` is the whole of this file's week handling. A
 * quantity out of range has an unambiguous nearest legal value: 20 sets means
 * "as many as possible", and 15 is a defensible reading of it. A week *number*
 * has none — it names a position, and clamping renames it. `week_number: 0`
 * became week 1 and overwrote the real week 1; `week_number: 99` became the
 * last week and overwrote the deload. Both produced a plan that validated
 * cleanly while silently carrying another week's programming.
 *
 * So an out-of-range or non-integer identifier is discarded and reported, never
 * moved.
 */
function identifier(value: unknown, min: number, max: number): number | null {
  const n = toNumber(value)
  if (n === null || !Number.isInteger(n) || n < min || n > max) return null
  return n
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

    // A weekday is an identifier too, not a quantity: `day_of_week: 9` clamped
    // to 7 put the session on Sunday — a day the model never chose and the
    // athlete never asked for, which `getNextSession` then prescribes as "lo
    // que toca hoy". Dropped instead, which leaves the session on the rotation
    // exactly as an unassigned one, and said out loud.
    const dayOfWeek = identifier(s.day_of_week, 1, 7)
    if (dayOfWeek == null && s.day_of_week != null) {
      warnings.push(`"${name}": día de la semana no válido (${JSON.stringify(s.day_of_week)}); la sesión queda sin día asignado.`)
    }
    if (dayOfWeek != null) {
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

      // Rounded first, then compared: `target_sets: 3.7` clamps to itself, so
      // the old order reported no change and stored 4 anyway.
      let sets = clamp(e.target_sets, LIMITS.sets.min, LIMITS.sets.max)
      if (sets == null) {
        sets = LIMITS.sets.fallback
        repairs.push(`"${exName}": sin series indicadas, se ponen ${sets}.`)
      } else {
        sets = Math.round(sets)
        if (e.target_sets !== sets) {
          repairs.push(`"${exName}": ${JSON.stringify(e.target_sets)} series ajustadas a ${sets}.`)
        }
      }

      let repMin = clamp(e.rep_min, LIMITS.reps.min, LIMITS.reps.max)
      let repMax = clamp(e.rep_max, LIMITS.reps.min, LIMITS.reps.max)
      // Reported like every other clamp: a plan that says 8-12 when the model
      // wrote 8-120 has been changed, and the athlete reviewing it should not
      // have to notice on their own.
      if (repMin != null && isFiniteNumber(e.rep_min) && e.rep_min !== repMin) {
        repairs.push(`"${exName}": repetición mínima ${e.rep_min} ajustada a ${repMin}.`)
      }
      if (repMax != null && isFiniteNumber(e.rep_max) && e.rep_max !== repMax) {
        repairs.push(`"${exName}": repetición máxima ${e.rep_max} ajustada a ${repMax}.`)
      }
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
      if (rest != null && isFiniteNumber(e.rest_seconds) && e.rest_seconds !== rest) {
        repairs.push(`"${exName}": descanso de ${e.rest_seconds} s ajustado a ${rest} s.`)
      }

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
  if (isFiniteNumber(options.durationWeeks) && options.durationWeeks !== duration) {
    warnings.push(`Se pidieron ${options.durationWeeks} semanas y el bloque se ha limitado a ${duration}.`)
  }
  const rawWeeks: any[] = Array.isArray(raw.weeks) ? raw.weeks : []

  // Each cause is counted apart, because they are different problems and the
  // athlete can only act on the one that happened. A single "se descartaron N
  // semanas" line conflated "the model numbered a week 0" with "it wrote week 3
  // twice", and it was computed as `rawWeeks.length - byNumber.size`, which
  // also counted a week that had merely been clamped onto another one.
  const byNumber = new Map<number, any>()
  let invalidWeeks = 0
  let duplicateWeeks = 0
  for (const w of rawWeeks) {
    const number = identifier(w?.week_number, 1, duration)
    if (number == null) {
      invalidWeeks++
      continue
    }
    // First one wins: a duplicated week number is a repeat, and picking the
    // later one would silently discard the earlier week's programming.
    if (byNumber.has(number)) {
      duplicateWeeks++
      continue
    }
    byNumber.set(number, w)
  }
  if (invalidWeeks > 0) {
    repairs.push(`Se descartaron ${invalidWeeks} semana(s) con número inválido o fuera del bloque de ${duration} semanas.`)
  }
  if (duplicateWeeks > 0) {
    repairs.push(`Se descartaron ${duplicateWeeks} semana(s) repetidas; se conserva la primera de cada número.`)
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
    if (rir != null && isFiniteNumber(w.target_rir) && Math.round(rir) !== w.target_rir) {
      repairs.push(`Semana ${number}: RIR objetivo ${w.target_rir} ajustado a ${Math.round(rir)}.`)
    }
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
