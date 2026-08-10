import { prisma } from './prisma'
import { calcE1RMWithRPE } from './volume-calculator'
import { loadTemplateTitles, normalizeExerciseName, resolveTitle } from './exercise-aliases'

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

  // A linked exercise is named by the catalogue, never by the caller: the plan
  // editor only ever adds exercises from the picker and the generator only from
  // its search, so there is no hand-typed name to preserve — and letting an
  // English title through here is what put the plan and the session log into
  // two different languages. Unlinked rows keep whatever name they arrived with,
  // since nothing else identifies them.
  const aliases = await loadTemplateTitles(userId, proposedIds)

  const unmatched: string[] = []

  // The replace destroys the rows that carry `hevy_routine_id`, so the link to
  // the routine already living in the athlete's Hevy account has to be carried
  // across by hand. Without this, editing a pushed plan makes the next push
  // create a second set of routines beside the first — the exact duplication
  // `hevy_routine_id` exists to prevent.
  //
  // Matched on name, not order: reordering the week is a normal edit and must
  // not re-point "Empuje A" at the routine that used to be "Tirón A". A renamed
  // session legitimately loses the link and is pushed as a new routine.
  const previous = await prisma.plannedSession.findMany({
    where: { mesocycle_id: mesocycleId, hevy_routine_id: { not: null } },
    select: { name: true, hevy_routine_id: true, pushed_at: true }
  })
  const pushedByName = new Map(previous.map(s => [s.name.trim().toLowerCase(), s]))

  await prisma.$transaction([
    prisma.plannedSession.deleteMany({ where: { mesocycle_id: mesocycleId } }),
    prisma.mesocycleWeek.deleteMany({ where: { mesocycle_id: mesocycleId } })
  ])

  let exerciseCount = 0
  for (const [index, session] of sessions.entries()) {
    const carried = pushedByName.get(session.name.trim().toLowerCase())
    await prisma.plannedSession.create({
      data: {
        mesocycle_id: mesocycleId,
        name: session.name,
        order_index: index,
        day_of_week: session.day_of_week ?? null,
        notes: session.notes ?? null,
        hevy_routine_id: carried?.hevy_routine_id ?? null,
        pushed_at: carried?.pushed_at ?? null,
        exercises: {
          create: session.exercises.map((e, i) => {
            const linked = e.exercise_template_id && known.has(e.exercise_template_id)
            if (e.exercise_template_id && !linked) unmatched.push(e.name)
            exerciseCount++
            return {
              exercise_template_id: linked ? e.exercise_template_id : null,
              name: linked ? resolveTitle(aliases, e.exercise_template_id, e.name) : e.name,
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

  // The displayed name is resolved on read, not trusted from the row. Plans
  // written before the catalogue spoke the athlete's language stored the
  // English title, and a plan is read far more often than it is saved — fixing
  // it here means an existing block reads correctly without being re-saved,
  // while `savePlan` keeps the stored copy in step for anything reading the
  // table directly.
  const aliases = await loadTemplateTitles(
    userId,
    mesocycle.planned_sessions.flatMap(s => s.exercises.map(e => e.exercise_template_id))
  )
  const sessions = mesocycle.planned_sessions.map(s => ({
    ...s,
    exercises: s.exercises.map(e => ({
      ...e,
      name: resolveTitle(aliases, e.exercise_template_id, e.name)
    }))
  }))

  return {
    mesocycle_id: mesocycle.id,
    name: mesocycle.name,
    start_date: mesocycle.start_date,
    end_date: mesocycle.end_date,
    hevy_folder_id: mesocycle.hevy_folder_id,
    weeks: mesocycle.planned_weeks,
    sessions,
    has_plan: sessions.length > 0
  }
}

/**
 * Rewrites stored plan names into the athlete's language.
 *
 * `loadPlan` already resolves the name on the way out, so this is not what
 * makes the plan *read* correctly — it is what makes `split_description`
 * correct, and that column is prose shown on the mesocycle page and fed to
 * every prompt in ai-prompts.ts. Deriving it is `savePlan`'s job; re-deriving
 * it here goes through the same `renderSplitDescription` so the two cannot
 * disagree.
 *
 * Only rows whose stored name already disagrees with the athlete's are
 * touched, and only mesocycles that actually changed are re-rendered, so a
 * second run does nothing — which is what makes it safe to call after every
 * sync. A mesocycle with no structured plan is never touched: its
 * `split_description` is hand-written prose that nothing here derives.
 */
export async function relabelPlannedExercises(
  userId: string
): Promise<{ exercises: number; mesocycles: number }> {
  const rows = await prisma.plannedExercise.findMany({
    where: {
      exercise_template_id: { not: null },
      planned_session: { mesocycle: { user_id: userId } }
    },
    select: {
      id: true, name: true, exercise_template_id: true,
      planned_session: { select: { mesocycle_id: true } }
    }
  })
  if (rows.length === 0) return { exercises: 0, mesocycles: 0 }

  const aliases = await loadTemplateTitles(userId, rows.map(r => r.exercise_template_id))
  const touched = new Set<string>()
  let renamed = 0

  for (const row of rows) {
    const title = row.exercise_template_id ? aliases.get(row.exercise_template_id) : undefined
    if (!title || title === row.name) continue
    await prisma.plannedExercise.update({ where: { id: row.id }, data: { name: title } })
    touched.add(row.planned_session.mesocycle_id)
    renamed++
  }

  for (const mesocycleId of touched) {
    const plan = await loadPlan(mesocycleId, userId)
    await prisma.mesocycle.update({
      where: { id: mesocycleId },
      data: { split_description: renderSplitDescription(plan.sessions) }
    })
  }

  return { exercises: renamed, mesocycles: touched.size }
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
  targetRir: number | null,
  templateId: string | null = null
): Promise<SuggestedLoad> {
  const select = {
    date: true, best_e1rm: true, top_set_weight: true, top_set_reps: true,
    sets: {
      where: { set_type: { not: 'warmup' } },
      orderBy: { weight_kg: 'desc' as const },
      take: 1,
      select: { weight_kg: true, reps: true, rpe: true }
    }
  }

  // Template id first. Keyed on the name alone, a default exercise never
  // matched its own history — the plan asks for "Bench Press (Barbell)" and the
  // log holds "Press de banca (Barra)" — so every non-custom lift reported "sin
  // historial" and offered no load.
  let last = templateId
    ? await prisma.workoutExercise.findFirst({
        where: { user_id: userId, exercise_template_id: templateId },
        orderBy: { date: 'desc' },
        select
      })
    : null

  // Falling back rather than OR-ing the two: sessions logged before the
  // template linked carry no id at all, and those are found by name. Kept as a
  // second query so a name shared by two different exercises can never outrank
  // the one the id actually identifies.
  if (!last) {
    last = await prisma.workoutExercise.findFirst({
      where: { user_id: userId, name: exerciseName },
      orderBy: { date: 'desc' },
      select
    })
  }

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
      const suggestion = await suggestLoad(userId, e.name, targetReps, rir, e.exercise_template_id)
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

  // Grouped by template id *and* name so both keys are available below. Matching
  // on the name alone is what this used to do, and it only ever worked for
  // custom exercises: Hevy's catalogue names a default exercise in English while
  // the session that performed it is logged in the athlete's language, so every
  // non-custom lift scored 0% no matter how faithfully it was trained.
  const performed = await prisma.workoutExercise.groupBy({
    by: ['exercise_template_id', 'name'],
    where: { user_id: userId, workout: { mesocycle_id: mesocycleId } },
    _sum: { working_sets: true },
    _count: { _all: true }
  })

  const byTemplate = new Map<string, { sets: number; sessions: number }>()
  const byName = new Map<string, { sets: number; sessions: number }>()
  for (const p of performed) {
    const done = { sets: p._sum.working_sets ?? 0, sessions: p._count._all }
    // The same template can appear under more than one name — a rename mid-block,
    // or a workout logged before the template linked — so accumulate, don't set.
    const add = (map: Map<string, { sets: number; sessions: number }>, key: string) => {
      const prev = map.get(key)
      map.set(key, prev
        ? { sets: prev.sets + done.sets, sessions: prev.sessions + done.sessions }
        : { ...done })
    }
    if (p.exercise_template_id) add(byTemplate, p.exercise_template_id)
    add(byName, normalizeExerciseName(p.name))
  }

  const rows = plan.sessions.flatMap(s =>
    s.exercises.map(e => {
      // Template id first: it is the same string in every language and survives
      // a rename. The name is the fallback for an exercise the catalogue never
      // resolved, on either side.
      const done = (e.exercise_template_id ? byTemplate.get(e.exercise_template_id) : undefined)
        ?? byName.get(normalizeExerciseName(e.name))
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
