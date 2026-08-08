import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { buildAthleteProfile, buildWorkoutData, extractCompoundLiftsData, buildNutritionSnapshot, type MesocycleGeneratePayload } from '../../utils/ai-payload'
import { runAiTask, aiKeysFromConfig } from '../../utils/ai-service'
import { MESOCYCLE_GENERATE_PROMPT } from '../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../utils/ai-config'
import { SEARCH_TEMPLATES_TOOL, searchExerciseTemplates } from '../../utils/exercise-search'
import { buildMuscleVolumeReport } from '../../utils/muscle-volume'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)

  const body = await readBody(event)
  const { goal, days_per_week, duration_weeks, equipment } = body

  if (!goal || !days_per_week || !duration_weeks) {
    throw createError({ statusCode: 400, statusMessage: 'Faltan campos requeridos: goal, days_per_week, duration_weeks' })
  }

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
    request: {
      goal,
      days_per_week,
      duration_weeks,
      ...(equipment && { equipment })
    },
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

  const { content } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    contextType: 'mesocycle_generate',
    systemPrompt: MESOCYCLE_GENERATE_PROMPT,
    payload,
    maxOutputTokens: MAX_OUTPUT_TOKENS.generation,
    jsonMode: true,
    // The catalogue is ~400 entries — too many for the prompt, and a made-up id
    // yields a plan that looks fine and fails on push. So it looks them up.
    tools: [SEARCH_TEMPLATES_TOOL],
    toolImpls: {
      search_exercise_templates: (args) => searchExerciseTemplates(userId, args)
    },
    maxToolIterations: 6
  })

  let plan: any
  try {
    plan = JSON.parse(content || '{}')
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'La IA no devolvió un plan válido. Inténtalo de nuevo.' })
  }

  // Reported rather than silently dropped: a plan whose exercises aren't in the
  // catalogue still trains fine, it just can't be pushed to Hevy.
  const sessions = Array.isArray(plan.sessions) ? plan.sessions : []
  const missingIds = sessions.flatMap((s: any) =>
    (s.exercises ?? [])
      .filter((e: any) => !e.exercise_template_id)
      .map((e: any) => e.name)
  )

  return {
    success: true,
    plan,
    ...(missingIds.length && {
      warning: `${missingIds.length} ejercicio(s) sin identificar en el catálogo (${missingIds.slice(0, 4).join(', ')}). El plan es válido, pero no se podrá enviar a Hevy hasta resolverlos.`
    })
  }
})
