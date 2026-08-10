import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { loadPlan, weekNumberFor } from '../../../utils/plan-service'
import { suggestLoad } from '../../../utils/plan-service'
import {
  createHevyRoutineFolder, createHevyRoutine, updateHevyRoutine,
  type HevyRoutinePayload
} from '../../../utils/hevy-client'

/**
 * Writes the structured plan to Hevy as routines.
 *
 * This is what closes the loop: the plan the app designed becomes the routine
 * the athlete opens at the gym, and the sessions they log come back through the
 * existing sync.
 *
 * Writes to the user's external Hevy account, so it only ever runs from an
 * explicit action — never as a side effect of saving a mesocycle. Re-sending
 * updates the routines already created (tracked by `hevy_routine_id`) instead
 * of duplicating them.
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)
  const mesocycleId = getRouterParam(event, 'id') as string

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hevy_api_key: true }
  })
  if (!user?.hevy_api_key || user.hevy_api_key.includes('your_hevy_api_key')) {
    throw createError({ statusCode: 400, message: 'Configura tu API Key de Hevy en Ajustes antes de enviar rutinas.' })
  }
  const apiKey = user.hevy_api_key

  const plan = await loadPlan(mesocycleId, userId)
  if (!plan.has_plan) {
    throw createError({ statusCode: 400, message: 'Este mesociclo no tiene un plan estructurado que enviar.' })
  }

  // Every exercise must resolve to a real template id — Hevy has no way to
  // accept an exercise by name, so a partial push would silently drop movements.
  const unresolved = plan.sessions.flatMap(s =>
    s.exercises.filter(e => !e.exercise_template_id).map(e => `${s.name}: ${e.name}`)
  )
  if (unresolved.length) {
    throw createError({
      statusCode: 400,
      message: `Estos ejercicios no están enlazados con el catálogo de Hevy y no se pueden enviar: ${unresolved.join(', ')}. Sincroniza el catálogo desde Administración o edítalos en el plan.`
    })
  }

  // One folder per block, created once and remembered.
  let folderId = plan.hevy_folder_id
  if (!folderId) {
    folderId = await createHevyRoutineFolder(apiKey, plan.name)
    if (folderId) {
      await prisma.mesocycle.update({ where: { id: mesocycleId }, data: { hevy_folder_id: folderId } })
    }
  }

  const week = weekNumberFor(plan.start_date, new Date())
  const weekPlan = plan.weeks.find(w => w.week_number === week)

  const created: string[] = []
  const updated: string[] = []

  for (const session of plan.sessions) {
    const exercises: HevyRoutinePayload['exercises'] = []

    for (const e of session.exercises) {
      const targetReps = e.rep_max ?? e.rep_min ?? 8
      const rir = weekPlan?.target_rir ?? e.target_rir ?? null
      const suggestion = await suggestLoad(userId, e.name, targetReps, rir, e.exercise_template_id)

      const setCount = weekPlan?.volume_multiplier
        ? Math.max(1, Math.round(e.target_sets * weekPlan.volume_multiplier))
        : e.target_sets

      exercises.push({
        exercise_template_id: e.exercise_template_id as string,
        rest_seconds: e.rest_seconds ?? null,
        notes: [
          rir != null ? `${rir} RIR` : null,
          suggestion.weight_kg ? `Sugerido ${suggestion.weight_kg} kg` : null,
          e.notes
        ].filter(Boolean).join(' · ') || null,
        sets: Array.from({ length: setCount }, () => ({
          type: 'normal' as const,
          // Left null when there is no history: prefilling an invented weight in
          // the app the athlete lifts from is worse than leaving it blank.
          weight_kg: suggestion.weight_kg,
          reps: e.rep_min ?? null,
          ...(e.rep_min && e.rep_max && e.rep_min !== e.rep_max && {
            rep_range: { start: e.rep_min, end: e.rep_max }
          })
        }))
      })
    }

    const routine = {
      title: `${plan.name} — ${session.name}`,
      notes: [
        session.notes,
        weekPlan?.is_deload ? 'Semana de descarga' : null,
        `Semana ${week}`
      ].filter(Boolean).join(' · '),
      exercises
    }

    if (session.hevy_routine_id) {
      await updateHevyRoutine(apiKey, session.hevy_routine_id, routine)
      updated.push(session.name)
      await prisma.plannedSession.update({
        where: { id: session.id },
        data: { pushed_at: new Date() }
      })
    } else {
      const routineId = await createHevyRoutine(apiKey, { ...routine, folder_id: folderId ?? null })
      created.push(session.name)
      await prisma.plannedSession.update({
        where: { id: session.id },
        data: { hevy_routine_id: routineId, pushed_at: new Date() }
      })
    }
  }

  return {
    success: true,
    week,
    is_deload: weekPlan?.is_deload ?? false,
    created,
    updated,
    message: `${created.length} rutina(s) creadas y ${updated.length} actualizadas en Hevy con las cargas de la semana ${week}.`
  }
})
