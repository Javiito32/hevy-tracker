import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { buildAthleteProfile, buildWorkoutData, extractCompoundLiftsData, buildNutritionSnapshot, type MesocycleGeneratePayload } from '../../utils/ai-payload'
import { runAiTask, aiKeysFromConfig } from '../../utils/ai-service'
import { MESOCYCLE_GENERATE_PROMPT } from '../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../utils/ai-config'

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
      select: { name: true, goal: true, split_description: true, target_volume_weekly: true }
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
      ...(m.target_volume_weekly != null && { sessions_per_week: m.target_volume_weekly })
    })),
    request: {
      goal,
      days_per_week,
      duration_weeks,
      ...(equipment && { equipment })
    },
    ...(nutrition && { nutrition })
  }

  const { content } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    contextType: 'mesocycle_generate',
    systemPrompt: MESOCYCLE_GENERATE_PROMPT,
    payload,
    maxOutputTokens: MAX_OUTPUT_TOKENS.generation,
    jsonMode: true
  })

  let plan: any
  try {
    plan = JSON.parse(content || '{}')
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'Error al procesar la respuesta de la IA' })
  }

  return { success: true, plan }
})
