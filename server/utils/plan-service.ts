import { prisma } from './prisma'
import { calcE1RMWithRPE } from './volume-calculator'

/**
 * The structured training plan.
 *
 * What separates this from `Mesocycle.split_description` is that every field
 * here is comparable against what the athlete actually logged. Prose can say
 * "4x8-10 en press banca"; only a row with `target_sets`, `rep_min`, `rep_max`
 * and `target_rir` can be checked against Monday's session, turned into a
 * suggested load, or pushed to Hevy as a routine.
 *
 * All plan mutation goes through this module — the same rule diet-service.ts
 * follows for totals, and for the same reason: `split_description` is
 * denormalised from the structure and drifts the moment something writes one
 * without the other.
 */

export interface PlannedExerciseInput {
  exercise_template_id?: string | null
  name: string
  target_sets?: number
  rep_min?: number | null
  rep_max?: number | null
  target_rir?: number | null
  rest_seconds?: number | null
  progression_scheme?: string
  notes?: string | null
}

export interface PlannedSessionInput {
  name: string
  day_of_week?: number | null
  notes?: string | null
  exercises: PlannedExerciseInput[]
}

export interface WeekInput {
  week_number: number
  is_deload?: boolean
  target_rir?: number | null
  volume_multiplier?: number
  notes?: string | null
}

const DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

/**
 * Renders the structure back into `split_description`.
 *
 * Kept as a derived field rather than dropped so every existing prompt in
 * ai-prompts.ts — which reads `split` from the payload — keeps working without
 * being rewritten, and so a plan still reads as prose to a human.
 */
export function renderSplitDescription(sessions: Array<{
  name: string
  day_of_week: number | null
  exercises: Array<{ name: string; target_sets: number; rep_min: number | null; rep_max: number | null; target_rir: number | null }>
}>): string {
  return sessions.map(s => {
    const day = s.day_of_week ? `${DAY_NAMES[s.day_of_week]}: ` : ''
    const lines = s.exercises.map(e => {
      const reps = e.rep_min && e.rep_max
        ? (e.rep_min === e.rep_max ? `${e.rep_min}` : `${e.rep_min}-${e.rep_max}`)
        : '?'
      const rir = e.target_rir != null ? ` @${e.target_rir} RIR` : ''
      return `  · ${e.name} — ${e.target_sets}×${reps}${rir}`
    })
    return `${day}${s.name}\n${lines.join('\n')}`
  }).join('\n\n')
}

/**
 * Replaces a mesocycle's whole plan.
 *
 * Replace rather than merge: an edited plan can drop a session or an exercise,
 * and merging would leave the removed ones behind with no way to tell them from
 * the current prescription.
 */
export async function savePlan(
  mesocycleId: string,
  userId: string,
  sessions: PlannedSessionInput[],
  weeks: WeekInput[] = []
): Promise<{ sessions: number; exercises: number; unmatched: string[] }> {
  const mesocycle = await prisma.mesocycle.findFirst({
    where: { id: mesocycleId, user_id: userId },
    select: { id: true }
  })
  if (!mesocycle) throw createError({ statusCode: 404, message: 'Mesociclo no encontrado' })

  // Only link template ids the catalogue actually knows. A dangling FK would
  // fail the whole write, and the plan is still usable without the link — it
  // just can't be pushed to Hevy until resolved.
  const proposedIds = sessions
    .flatMap(s => s.exercises.map(e => e.exercise_template_id))
    .filter(Boolean) as string[]
  const known = proposedIds.length
    ? new Set((await prisma.exerciseTemplate.findMany({
        where: { id: { in: proposedIds } }, select: { id: true }
      })).map(t => t.id))
    : new Set<string>()

  const unmatched: string[] = []

  await prisma.$transaction([
    prisma.plannedSession.deleteMany({ where: { mesocycle_id: mesocycleId } }),
    prisma.mesocycleWeek.deleteMany({ where: { mesocycle_id: mesocycleId } })
  ])

  let exerciseCount = 0
  for (const [index, session] of sessions.entries()) {
    await prisma.plannedSession.create({
      data: {
        mesocycle_id: mesocycleId,
        name: session.name,
        order_index: index,
        day_of_week: session.day_of_week ?? null,
        notes: session.notes ?? null,
        exercises: {
          create: session.exercises.map((e, i) => {
            const linked = e.exercise_template_id && known.has(e.exercise_template_id)
            if (e.exercise_template_id && !linked) unmatched.push(e.name)
            exerciseCount++
            return {
              exercise_template_id: linked ? e.exercise_template_id : null,
              name: e.name,
              order_index: i,
              target_sets: e.target_sets ?? 3,
              rep_min: e.rep_min ?? null,
              rep_max: e.rep_max ?? null,
              target_rir: e.target_rir ?? null,
              rest_seconds: e.rest_seconds ?? null,
              progression_scheme: e.progression_scheme ?? 'double_progression',
              notes: e.notes ?? null
            }
          })
        }
      }
    })
  }

  if (weeks.length) {
    await prisma.mesocycleWeek.createMany({
      data: weeks.map(w => ({
        mesocycle_id: mesocycleId,
        week_number: w.week_number,
        is_deload: w.is_deload ?? false,
        target_rir: w.target_rir ?? null,
        volume_multiplier: w.volume_multiplier ?? 1,
        notes: w.notes ?? null
      }))
    })
  }

  // Keep the prose in step with the structure, in the same call that wrote it.
  const stored = await loadPlan(mesocycleId, userId)
  await prisma.mesocycle.update({
    where: { id: mesocycleId },
    data: {
      split_description: renderSplitDescription(stored.sessions),
      target_sessions_weekly: sessions.length || null
    }
  })

  return { sessions: sessions.length, exercises: exerciseCount, unmatched: [...new Set(unmatched)] }
}

export async function loadPlan(mesocycleId: string, userId: string) {
  const mesocycle = await prisma.mesocycle.findFirst({
    where: { id: mesocycleId, user_id: userId },
    select: {
      id: true, name: true, start_date: true, end_date: true, hevy_folder_id: true,
      planned_weeks: { orderBy: { week_number: 'asc' } },
      planned_sessions: {
        orderBy: { order_index: 'asc' },
        include: { exercises: { orderBy: { order_index: 'asc' } } }
      }
    }
  })
  if (!mesocycle) throw createError({ statusCode: 404, message: 'Mesociclo no encontrado' })

  return {
    mesocycle_id: mesocycle.id,
    name: mesocycle.name,
    start_date: mesocycle.start_date,
    end_date: mesocycle.end_date,
    hevy_folder_id: mesocycle.hevy_folder_id,
    weeks: mesocycle.planned_weeks,
    sessions: mesocycle.planned_sessions,
    has_plan: mesocycle.planned_sessions.length > 0
  }
}

/** 1-based week of the block on a given date. */
export function weekNumberFor(startDate: Date, on = new Date()): number {
  const ms = on.getTime() - new Date(startDate).getTime()
  return Math.max(1, Math.floor(ms / (7 * 86_400_000)) + 1)
}

export interface SuggestedLoad {
  weight_kg: number | null
  /** Why this number, so the athlete can disagree with the reasoning not just the figure. */
  basis: string
  last_performance: { weight_kg: number; reps: number; rpe: number | null; date: Date } | null
}

/**
 * Suggests a working load for a planned exercise.
 *
 * Anchored to what the athlete last actually did, not to a percentage of a 1RM
 * they may never have tested. Returns null with a stated reason rather than a
 * guess when there is no history — an invented starting weight is how people
 * get hurt.
 */
export async function suggestLoad(
  userId: string,
  exerciseName: string,
  targetReps: number,
  targetRir: number | null
): Promise<SuggestedLoad> {
  const last = await prisma.workoutExercise.findFirst({
    where: { user_id: userId, name: exerciseName },
    orderBy: { date: 'desc' },
    select: {
      date: true, best_e1rm: true, top_set_weight: true, top_set_reps: true,
      sets: {
        where: { set_type: { not: 'warmup' } },
        orderBy: { weight_kg: 'desc' },
        take: 1,
        select: { weight_kg: true, reps: true, rpe: true }
      }
    }
  })

  if (!last?.sets.length || !last.sets[0].weight_kg) {
    return {
      weight_kg: null,
      basis: 'Sin historial de este ejercicio: elige un peso conservador en la primera sesión y ajústalo por sensaciones.',
      last_performance: null
    }
  }

  const top = last.sets[0]
  const lastPerf = {
    weight_kg: top.weight_kg!,
    reps: top.reps ?? 0,
    rpe: top.rpe,
    date: last.date
  }

  // Convert the last set to a 1RM, then back down to the prescribed reps and
  // RIR. Going through a 1RM is what lets a set of 5 inform a prescription of 10.
  const e1rm = calcE1RMWithRPE(top.weight_kg, top.reps, top.rpe) ?? last.best_e1rm
  if (!e1rm) {
    return {
      weight_kg: lastPerf.weight_kg,
      basis: `Repite la carga de la última sesión (${lastPerf.weight_kg} kg × ${lastPerf.reps}); sin RPE registrado no se puede afinar más.`,
      last_performance: lastPerf
    }
  }

  const rir = targetRir ?? 2
  const repsToFailure = Math.round(targetReps + rir)
  const PCT: Record<number, number> = {
    1: 100, 2: 95.5, 3: 92.2, 4: 89.2, 5: 86.3, 6: 83.7,
    7: 81.1, 8: 78.6, 9: 76.2, 10: 73.9, 11: 70.7, 12: 68.0
  }
  const pct = PCT[Math.min(12, Math.max(1, repsToFailure))]

  // Rounded to 2.5 kg, the smallest increment most gyms can actually load.
  const raw = e1rm * (pct / 100)
  const weight = Math.round(raw / 2.5) * 2.5

  return {
    weight_kg: weight,
    basis: `Desde tu 1RM estimado de ${e1rm.toFixed(1)} kg (última sesión: ${lastPerf.weight_kg} kg × ${lastPerf.reps}${lastPerf.rpe ? ` @RPE ${lastPerf.rpe}` : ''}), para ${targetReps} repeticiones a ${rir} RIR.`,
    last_performance: lastPerf
  }
}

/**
 * The session due next, with a suggested load per exercise.
 *
 * Picks by weekday when the plan assigns one, otherwise rotates: the session
 * after the last one trained. A plan with no weekday assignment is a rotation
 * by definition, so honouring the order is the only correct reading.
 */
export async function getNextSession(userId: string, mesocycleId: string) {
  const plan = await loadPlan(mesocycleId, userId)
  if (!plan.has_plan) return { has_plan: false as const }

  const today = new Date()
  const isoDay = today.getDay() === 0 ? 7 : today.getDay()

  let session = plan.sessions.find(s => s.day_of_week === isoDay)

  if (!session) {
    const lastWorkout = await prisma.workout.findFirst({
      where: { user_id: userId, mesocycle_id: mesocycleId },
      orderBy: { date: 'desc' },
      select: { name: true }
    })
    const lastIndex = lastWorkout
      ? plan.sessions.findIndex(s => s.name.toLowerCase() === lastWorkout.name.toLowerCase())
      : -1
    session = plan.sessions[(lastIndex + 1) % plan.sessions.length]
  }

  const week = weekNumberFor(plan.start_date, today)
  const weekPlan = plan.weeks.find(w => w.week_number === week)

  const exercises = await Promise.all(
    session.exercises.map(async (e) => {
      const targetReps = e.rep_max ?? e.rep_min ?? 8
      // The week's RIR overrides the exercise's: a deload week is defined by
      // backing everything off, not by exceptions per movement.
      const rir = weekPlan?.target_rir ?? e.target_rir ?? null
      const suggestion = await suggestLoad(userId, e.name, targetReps, rir)
      return {
        ...e,
        target_sets: weekPlan?.volume_multiplier
          ? Math.max(1, Math.round(e.target_sets * weekPlan.volume_multiplier))
          : e.target_sets,
        effective_rir: rir,
        suggestion
      }
    })
  )

  return {
    has_plan: true as const,
    week,
    is_deload: weekPlan?.is_deload ?? false,
    week_notes: weekPlan?.notes ?? null,
    session: { id: session.id, name: session.name, notes: session.notes, day_of_week: session.day_of_week },
    exercises
  }
}

/**
 * Planned versus performed for a block, per exercise.
 *
 * Adherence used to mean "sessions logged this week", which counts showing up.
 * This counts whether the prescription was followed.
 */
export async function getAdherence(userId: string, mesocycleId: string) {
  const plan = await loadPlan(mesocycleId, userId)
  if (!plan.has_plan) return { has_plan: false as const }

  const weeksElapsed = Math.max(1, weekNumberFor(plan.start_date, new Date()))

  const performed = await prisma.workoutExercise.groupBy({
    by: ['name'],
    where: { user_id: userId, workout: { mesocycle_id: mesocycleId } },
    _sum: { working_sets: true },
    _count: { _all: true }
  })
  const performedByName = new Map(performed.map(p => [
    p.name.toLowerCase(),
    { sets: p._sum.working_sets ?? 0, sessions: p._count._all }
  ]))

  const rows = plan.sessions.flatMap(s =>
    s.exercises.map(e => {
      const done = performedByName.get(e.name.toLowerCase())
      const plannedSets = e.target_sets * weeksElapsed
      const actualSets = done?.sets ?? 0
      return {
        session: s.name,
        exercise: e.name,
        planned_sets_to_date: plannedSets,
        actual_sets: actualSets,
        sessions_done: done?.sessions ?? 0,
        // Capped at 999% so one mis-logged session can't render a bar off-screen.
        adherence_pct: plannedSets > 0
          ? Math.min(999, Math.round((actualSets / plannedSets) * 100))
          : null
      }
    })
  )

  const totalPlanned = rows.reduce((s, r) => s + r.planned_sets_to_date, 0)
  const totalActual = rows.reduce((s, r) => s + r.actual_sets, 0)

  return {
    has_plan: true as const,
    weeks_elapsed: weeksElapsed,
    overall_pct: totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : null,
    rows: rows.sort((a, b) => (a.adherence_pct ?? 0) - (b.adherence_pct ?? 0))
  }
}
