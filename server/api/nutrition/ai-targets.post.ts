import { getSessionUser } from '../../utils/session'
import {
  buildAthleteProfile,
  buildNutritionSnapshot,
  buildNutritionHistory,
  buildTrainingLoad,
  type NutritionTargetsPayload
} from '../../utils/ai-payload'
import { runAiTask, aiKeysFromConfig, parseAiJson } from '../../utils/ai-service'
import { NUTRITION_TARGETS_PROMPT } from '../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../utils/ai-config'

const GOALS = ['bulk', 'cut', 'maintenance', 'recomp']

/**
 * Proposes daily targets for a goal. Returns structured JSON rather than prose
 * so the page can offer a one-click "Aplicar objetivos" — a paragraph the user
 * has to retype by hand would be worth much less.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const body = await readBody(event)
  const goal = body?.goal

  if (!GOALS.includes(goal)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Objetivo no válido. Usa uno de: ${GOALS.join(', ')}`
    })
  }

  const [athlete, currentNutrition, nutritionHistory, trainingLoad] = await Promise.all([
    buildAthleteProfile(userId),
    buildNutritionSnapshot(userId),
    buildNutritionHistory(userId),
    buildTrainingLoad(userId)
  ])

  const rate = Number(body?.rate_kg_per_week)

  const payload: NutritionTargetsPayload = {
    task: 'nutrition_targets',
    today: new Date().toISOString().substring(0, 10),
    athlete,
    request: {
      goal,
      ...(Number.isFinite(rate) && rate > 0 && { rate_kg_per_week: rate }),
      ...(body?.notes && { notes: String(body.notes) })
    },
    ...(currentNutrition && { current_nutrition: currentNutrition }),
    nutrition_history: nutritionHistory,
    training_load: trainingLoad
  }

  const { content, model } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    contextType: 'nutrition_targets',
    systemPrompt: NUTRITION_TARGETS_PROMPT,
    payload,
    maxOutputTokens: MAX_OUTPUT_TOKENS.generation,
    jsonMode: true
  })

  const targets = parseAiJson<any>(content, 'calcular los objetivos')

  return { success: true, targets, model }
})
