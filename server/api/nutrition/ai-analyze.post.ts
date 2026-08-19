import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import {
  buildAthleteProfile,
  buildNutritionSnapshot,
  buildNutritionHistory,
  buildTrainingLoad,
  type NutritionAnalysisPayload
} from '../../utils/ai-payload'
import { renderNutritionAnalysis } from '../../utils/ai-serialize'
import { runAiTask, aiKeysFromConfig } from '../../utils/ai-service'
import { NUTRITION_ANALYSIS_PROMPT } from '../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../utils/ai-config'
import { localDayKey } from '../../utils/dates'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)

  const [athlete, nutrition, nutritionHistory, trainingLoad, activeMesocycle] = await Promise.all([
    buildAthleteProfile(userId),
    // The one task that needs the menu, and it needs ALL of it.
    //
    // `'representative'` sent the meals of the most common day pattern only,
    // while the prompt asks this task to "contrasta día a día: qué días entrena
    // frente a qué días come más" and to answer with "qué comida tocar, qué
    // alimento subir o bajar y en cuántos gramos". On any diet with a weekday
    // and a weekend pattern that is a request to name a food on a day whose
    // foods were withheld — so the model either declined or named one from
    // Monday. `'full'` collapses identical days, so the cost is per distinct
    // pattern (typically two or three), not per weekday.
    buildNutritionSnapshot(userId, { detail: 'full' }),
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
    today: localDayKey(new Date()),
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
    task: 'nutrition_analysis',
    systemPrompt: NUTRITION_ANALYSIS_PROMPT,
    payload: renderNutritionAnalysis(payload),
    maxOutputTokens: MAX_OUTPUT_TOKENS.analysis
  })

  return { success: true, analysis: content, model }
})
