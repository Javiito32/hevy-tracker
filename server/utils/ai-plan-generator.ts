import { prisma } from './prisma'
import {
  buildAthleteProfile,
  buildWorkoutData,
  extractCompoundLiftsData,
  buildNutritionSnapshot,
  type MesocycleGeneratePayload
} from './ai-payload'
import { runAiTask, parseAiJson } from './ai-service'
import type { AiKeys } from './ai-provider'
import { MESOCYCLE_GENERATE_PROMPT } from './ai-prompts'
import { MAX_OUTPUT_TOKENS } from './ai-config'
import { SEARCH_TEMPLATES_TOOL, searchExerciseTemplates } from './exercise-search'
import { buildMuscleVolumeReport } from './muscle-volume'

/**
 * Mesocycle generation, extracted from the endpoint so it can run as a
 * background job.
 *
 * It is the app's longest single AI task by a wide margin: several rounds of
 * catalogue lookups, each a separately billed model call that reasons before it
 * answers, followed by a final turn emitting the whole block as JSON. Minutes,
 * not seconds — past any reverse proxy's read timeout, which is what turned a
 * working generation into a 504 with nothing to show for the tokens spent.
 */

export interface PlanRequest {
  goal: string
  days_per_week: number
  duration_weeks: number
  equipment?: string
}

export interface PlanResult {
  plan: any
  /** Present when some exercises carry no catalogue id — see below. */
  warning?: string
  model: string
  tokens_used: number
}

export async function generateMesocyclePlan(
  userId: string,
  keys: AiKeys,
  request: PlanRequest,
  progress?: (message: string) => Promise<void>
): Promise<PlanResult> {
  await progress?.('Reuniendo tu historial de entrenamiento…')

  const [athlete, recentWorkouts, previousMesocycles, nutrition] = await Promise.all([
    buildAthleteProfile(userId, { includeInjuries: true }),
    prisma.workout.findMany({
      where: { user_id: userId },
      take: 5,
      orderBy: { date: 'desc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, exercises_summary: true, notes: true, duration: true }
    }),
    prisma.mesocycle.findMany({
      where: { user_id: userId, status: { in: ['completed', 'paused'] } },
      orderBy: { start_date: 'desc' },
      take: 2,
      select: { name: true, goal: true, split_description: true, target_sessions_weekly: true }
    }),
    buildNutritionSnapshot(userId)
  ])

  const payload: MesocycleGeneratePayload = {
    task: 'mesocycle_generate',
    today: new Date().toISOString().substring(0, 10),
    athlete,
    recent_workouts: recentWorkouts.map(w => buildWorkoutData(w, true)),
    compound_lifts: extractCompoundLiftsData(recentWorkouts),
    previous_mesocycles: previousMesocycles.map(m => ({
      name: m.name,
      ...(m.goal && { goal: m.goal }),
      ...(m.split_description && { split: m.split_description }),
      ...(m.target_sessions_weekly != null && { sessions_per_week: m.target_sessions_weekly })
    })),
    request,
    ...(nutrition && { nutrition })
  }

  // The athlete's actual set distribution, so the new block corrects what the
  // last one under- or over-trained instead of restating a generic template.
  const muscleVolume = await buildMuscleVolumeReport(userId, 8)
  if (muscleVolume.averages.length) {
    payload.muscle_volume = muscleVolume.averages.map(a => ({
      muscle: a.muscle,
      label: a.label,
      avg_weekly_sets: a.avg_sets,
      verdict: a.verdict,
      ...(a.landmarks && { mev: a.landmarks.mev, mav: a.landmarks.mav, mrv: a.landmarks.mrv })
    }))
  }

  await progress?.('Diseñando el bloque y buscando ejercicios en el catálogo…')

  const { content, model, tokensUsed } = await runAiTask({
    keys,
    userId,
    contextType: 'mesocycle_generate',
    systemPrompt: MESOCYCLE_GENERATE_PROMPT,
    payload,
    maxOutputTokens: MAX_OUTPUT_TOKENS.planGeneration,
    jsonMode: true,
    // The catalogue is ~400 entries — too many for the prompt, and a made-up id
    // yields a plan that looks fine and fails on push. So it looks them up.
    tools: [SEARCH_TEMPLATES_TOOL],
    toolImpls: {
      search_exercise_templates: (args) => searchExerciseTemplates(userId, args)
    },
    maxToolIterations: 6,
    onToolRound: async (round) => {
      await progress?.(`Buscando ejercicios en el catálogo (ronda ${round})…`)
    }
  })

  await progress?.('Comprobando el plan…')

  const plan = parseAiJson<any>(content, 'generar el plan')

  // A parsed object with no sessions in it is not a plan. Returned as a success
  // it reaches the form as an empty response — every field left as it was,
  // nothing to retry from — so it fails here, where the reason can be stated.
  const sessions = Array.isArray(plan.sessions) ? plan.sessions : []
  if (!sessions.length) {
    throw createError({
      statusCode: 502,
      statusMessage: 'La IA devolvió un plan sin sesiones de entrenamiento. Inténtalo de nuevo, o reduce los días por semana.'
    })
  }

  // Shape-checked before it leaves the server. `plan.put.ts` validates the same
  // things at save time, but the form renders a preview of the plan first, and
  // a null session there surfaces as a raw "Cannot read properties of undefined"
  // in the browser — an error that says nothing about what actually went wrong.
  const isUsableExercise = (e: any) => e && typeof e === 'object' && typeof e.name === 'string' && e.name.trim()
  const malformed = sessions.some((s: any) =>
    !s || typeof s !== 'object' ||
    typeof s.name !== 'string' || !s.name.trim() ||
    !Array.isArray(s.exercises) || !s.exercises.length ||
    !s.exercises.every(isUsableExercise)
  )
  if (malformed) {
    throw createError({
      statusCode: 502,
      statusMessage: 'La IA devolvió un plan con sesiones incompletas. Inténtalo de nuevo.'
    })
  }

  // Reported rather than silently dropped: a plan whose exercises aren't in the
  // catalogue still trains fine, it just can't be pushed to Hevy.
  const missingIds = sessions.flatMap((s: any) =>
    s.exercises
      .filter((e: any) => !e.exercise_template_id)
      .map((e: any) => e.name)
  )

  return {
    plan,
    model,
    tokens_used: tokensUsed,
    ...(missingIds.length && {
      warning: `${missingIds.length} ejercicio(s) sin identificar en el catálogo (${missingIds.slice(0, 4).join(', ')}). El plan es válido, pero no se podrá enviar a Hevy hasta resolverlos.`
    })
  }
}
