import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import {
  buildAthleteProfile,
  buildNutritionSnapshot,
  buildNutritionHistory,
  buildTrainingLoad,
  type NutritionAnalysisPayload
} from '../../utils/ai-payload'
import { runAiTask, aiKeysFromConfig } from '../../utils/ai-service'
import { NUTRITION_ANALYSIS_PROMPT } from '../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../utils/ai-config'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)

  const [athlete, nutrition, nutritionHistory, trainingLoad, activeMesocycle] = await Promise.all([
    buildAthleteProfile(userId),
    // The one task that needs the menu: its recommendations name the meal and
    // the food to change. Everywhere else the snapshot is macros only.
    buildNutritionSnapshot(userId, { detail: 'representative' }),
    buildNutritionHistory(userId),
    buildTrainingLoad(userId),
    prisma.mesocycle.findFirst({
      where: { user_id: userId, status: 'active' },
      select: { name: true, goal: true, split_description: true }
    })
  ])

  if (!nutrition) {
    throw createError({
      statusCode: 400,
      statusMessage: 'No hay ninguna dieta publicada que analizar. Publica una versión primero.'
    })
  }

  const payload: NutritionAnalysisPayload = {
    task: 'nutrition_analysis',
    today: new Date().toISOString().substring(0, 10),
    athlete,
    nutrition,
    nutrition_history: nutritionHistory,
    training_load: trainingLoad,
    ...(activeMesocycle && {
      active_mesocycle: {
        name: activeMesocycle.name,
        ...(activeMesocycle.goal && { goal: activeMesocycle.goal }),
        ...(activeMesocycle.split_description && { split: activeMesocycle.split_description })
      }
    })
  }

  const { content, model } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    contextType: 'nutrition_analysis',
    systemPrompt: NUTRITION_ANALYSIS_PROMPT,
    payload,
    maxOutputTokens: MAX_OUTPUT_TOKENS.analysis
  })

  return { success: true, analysis: content, model }
})
