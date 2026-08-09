import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { aiKeysFromConfig } from '../../utils/ai-service'
import { isAiConfigured } from '../../utils/ai-provider'
import { startJob } from '../../utils/maintenance'
import { generateMesocyclePlan } from '../../utils/ai-plan-generator'

/**
 * Launches mesocycle generation as a background job and returns its id.
 *
 * It used to answer inline. Generating a block is several rounds of catalogue
 * lookups plus a final turn emitting the whole plan as JSON — minutes of model
 * time, which sits past the read timeout of any reverse proxy in front of the
 * app. The proxy would hang up with a 504 while the generation carried on to
 * completion behind it, so the tokens were spent and the plan was thrown away.
 *
 * Poll GET /api/mesocycles/ai-generate/:jobId for progress and the result.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)

  const body = await readBody(event)
  const { goal, days_per_week, duration_weeks, equipment } = body

  if (!goal || !days_per_week || !duration_weeks) {
    throw createError({ statusCode: 400, statusMessage: 'Faltan campos requeridos: goal, days_per_week, duration_weeks' })
  }

  const keys = aiKeysFromConfig(config)
  // Checked here rather than inside the job: a missing key is the caller's
  // problem to fix, and reporting it as a failed job would bury it a poll away.
  if (!isAiConfigured(keys)) {
    throw createError({ statusCode: 503, statusMessage: 'AI API Key no configurada' })
  }

  // Both preconditions are verified before a single token is spent. Without a
  // catalogue the model has nothing to resolve ids against: it would burn every
  // tool round on empty searches and return a plan that cannot be pushed to
  // Hevy — a full generation's cost to learn something a COUNT(*) answers.
  const catalogueSize = await prisma.exerciseTemplate.count()
  if (catalogueSize === 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'El catálogo de ejercicios está vacío. Sincronízalo desde el panel de administración antes de generar un plan.'
    })
  }

  const request = {
    goal,
    days_per_week: Number(days_per_week),
    duration_weeks: Number(duration_weeks),
    ...(equipment && { equipment })
  }

  const jobId = await startJob(
    'ai_generate_plan',
    userId,
    async (ctx) => {
      const result = await generateMesocyclePlan(userId, keys, request, ctx.progress)
      return { ...result } as Record<string, unknown>
    },
    // Each generation answers a different set of parameters, so handing back one
    // already in flight would return a plan for days/weeks nobody asked for.
    { reuseRunning: false }
  )

  return { success: true, jobId, message: 'Generación iniciada.' }
})
