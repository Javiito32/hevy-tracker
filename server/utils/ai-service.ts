import { prisma } from './prisma'
import { createAiProvider, type AiKeys, type TokenUsage } from './ai-provider'

/** Extracts the AI provider keys from Nuxt's runtime config. */
export function aiKeysFromConfig(config: { openaiApiKey?: string; openrouterApiKey?: string }): AiKeys {
  return { openaiApiKey: config.openaiApiKey, openrouterApiKey: config.openrouterApiKey }
}

/**
 * Shared runner for the stateless analysis/generation endpoints.
 *
 * Pattern: system prompt = persona + instructions (no data);
 * user message = JSON payload with all structured data.
 * Usage accounting is persisted to AiConversation/AiMessage for the admin stats.
 */

interface AiTaskOptions {
  keys: AiKeys
  userId: string
  /** Stored as AiConversation.context_type — powers the admin usage stats. */
  contextType: string
  systemPrompt: string
  payload: unknown
  maxOutputTokens: number
  jsonMode?: boolean
}

interface AiTaskResult {
  content: string
  model: string
  tokensUsed: number
  usage: TokenUsage
}

export async function runAiTask(options: AiTaskOptions): Promise<AiTaskResult> {
  const provider = createAiProvider(options.keys)

  const result = await provider.generate(
    [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: JSON.stringify(options.payload, null, 2) }
    ],
    {
      maxOutputTokens: options.maxOutputTokens,
      jsonMode: options.jsonMode
    }
  )

  const content = result.text ?? ''

  if (result.usage.totalTokens > 0) {
    await recordAiInteraction({
      userId: options.userId,
      contextType: options.contextType,
      content,
      usage: result.usage,
      model: provider.model
    })
  }

  return {
    content,
    model: provider.model,
    tokensUsed: result.usage.totalTokens,
    usage: result.usage
  }
}

export async function recordAiInteraction(args: {
  userId: string
  contextType: string
  content: string
  usage: TokenUsage
  model: string
}): Promise<void> {
  const convo = await prisma.aiConversation.create({
    data: { context_type: args.contextType, user_id: args.userId }
  })
  await prisma.aiMessage.create({
    data: {
      conversation_id: convo.id,
      role: 'assistant',
      content: args.content,
      tokens_used: args.usage.totalTokens,
      input_tokens: args.usage.inputTokens || null,
      output_tokens: args.usage.outputTokens || null,
      model_used: args.model
    }
  })
}
