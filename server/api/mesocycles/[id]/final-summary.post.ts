import { prisma } from '../../../utils/prisma'
import { getSessionUser } from '../../../utils/session'
import { buildFinalSummaryPayload } from '../../../utils/ai-payload'
import { renderFinalSummary } from '../../../utils/ai-serialize'
import { runAiTask, aiKeysFromConfig } from '../../../utils/ai-service'
import { FINAL_SUMMARY_PROMPT } from '../../../utils/ai-prompts'
import { MAX_OUTPUT_TOKENS } from '../../../utils/ai-config'

/**
 * Summarises a finished block.
 *
 * The payload is assembled in `ai-payload.ts` rather than here, for the same
 * reason `ai-generate` lives in `ai-plan-generator.ts`: its guarantee is a
 * temporal one — nothing in it may postdate the block — and a guarantee that
 * only exists inside a request handler cannot be tested without one.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')

  if (!id) throw createError({ statusCode: 400, statusMessage: 'ID required' })

  const payload = await buildFinalSummaryPayload(userId, id)
  if (!payload) throw createError({ statusCode: 404, statusMessage: 'Mesocycle not found' })

  const { content: finalSummary, model } = await runAiTask({
    keys: aiKeysFromConfig(config),
    userId,
    task: 'final_summary',
    systemPrompt: FINAL_SUMMARY_PROMPT,
    payload: renderFinalSummary(payload),
    maxOutputTokens: MAX_OUTPUT_TOKENS.finalSummary
  })

  await prisma.mesocycle.update({ where: { id }, data: { final_summary: finalSummary, final_summary_model: model } })

  return { success: true, final_summary: finalSummary, model }
})
