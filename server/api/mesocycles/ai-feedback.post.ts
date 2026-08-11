import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { buildAthleteProfile, buildWorkoutData, buildLastMesocycleSummaryData, buildNutritionSnapshot, type MesocycleFeedbackPayload } from '../../utils/ai-payload'
import { renderMesocycleFeedback } from '../../utils/ai-serialize'
import { runAiTask, aiKeysFromConfig } from '../../utils/ai-service'
import { MESOCYCLE_FEEDBACK_PROMPT } from '../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../utils/ai-config'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)

  const body = await readBody(event)
  const { name, goal, split_description, target_sessions_weekly, duration_weeks, notes } = body

  const [athlete, recentWorkouts, baselineMesocycle, nutrition] = await Promise.all([
    buildAthleteProfile(userId),
    prisma.workout.findMany({
      where: { user_id: userId },
      take: 5,
      orderBy: { date: 'desc' },
      select: { name: true, date: true, total_volume: true, rpe_avg: true, notes: true }
    }),
    buildLastMesocycleSummaryData(userId),
    buildNutritionSnapshot(userId)
  ])

  const payload: MesocycleFeedbackPayload = {
    task: 'mesocycle_feedback',
    today: new Date().toISOString().substring(0, 10),
    athlete,
    recent_workouts: recentWorkouts.map(w => buildWorkoutData(w, false)),
    plan: {
      ...(name && { name }),
      ...(goal && { goal }),
      ...(duration_weeks && { duration_weeks }),
      ...(target_sessions_weekly != null && { sessions_per_week: target_sessions_weekly }),
      ...(split_description && { split_description }),
      ...(notes && { notes })
    },
    ...(baselineMesocycle && { baseline_mesocycle: baselineMesocycle }),
    ...(nutrition && { nutrition })
  }

  const { content, model } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    task: 'mesocycle_feedback',
    systemPrompt: MESOCYCLE_FEEDBACK_PROMPT,
    payload: renderMesocycleFeedback(payload),
    maxOutputTokens: MAX_OUTPUT_TOKENS.analysis
  })

  return { success: true, feedback: content || 'No se pudo generar el análisis.', model }
})
