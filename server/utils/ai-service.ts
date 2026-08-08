import { prisma } from './prisma'
import { createAiProvider, type AiKeys, type TokenUsage, type ToolDefinition, type ChatMessage } from './ai-provider'

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
  /**
   * Optional tools. Stateless tasks are one-shot by default, but the plan
   * generator needs to look up real exercise ids mid-task — the catalogue is
   * too large to inline and inventing ids produces plans that fail on push.
   */
  tools?: ToolDefinition[]
  toolImpls?: Record<string, (args: any) => Promise<unknown>>
  /** Rounds of tool calls before the model is forced to answer. */
  maxToolIterations?: number
}

interface AiTaskResult {
  content: string
  model: string
  tokensUsed: number
  usage: TokenUsage
}

export async function runAiTask(options: AiTaskOptions): Promise<AiTaskResult> {
  const provider = createAiProvider(options.keys)

  const messages: ChatMessage[] = [
    { role: 'system', content: options.systemPrompt },
    { role: 'user', content: JSON.stringify(options.payload, null, 2) }
  ]

  const usesTools = Boolean(options.tools?.length && options.toolImpls)
  const maxIterations = usesTools ? (options.maxToolIterations ?? 4) : 1

  // Usage is SUMMED across iterations: each tool round is a separately billed
  // call, so reporting only the last one would undercount the task's cost —
  // the same reason runChatTurn sums.
  let totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  let content = ''

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const isFinal = iteration === maxIterations - 1
    const result = await provider.generate(messages, {
      maxOutputTokens: options.maxOutputTokens,
      // JSON mode is withheld until the final turn: a model forced to emit JSON
      // cannot express a tool call, so requesting both at once silently
      // disables the tools.
      jsonMode: options.jsonMode && (!usesTools || isFinal),
      ...(usesTools && {
        tools: options.tools,
        toolChoice: isFinal ? 'none' as const : 'auto' as const
      })
    })

    totalUsage = {
      inputTokens: totalUsage.inputTokens + result.usage.inputTokens,
      outputTokens: totalUsage.outputTokens + result.usage.outputTokens,
      totalTokens: totalUsage.totalTokens + result.usage.totalTokens
    }
    content = result.text ?? ''

    const calls = result.toolCalls ?? []
    if (!usesTools || calls.length === 0 || isFinal) break

    messages.push({ role: 'assistant', content: result.text ?? '', toolCalls: calls })
    for (const call of calls) {
      const impl = options.toolImpls?.[call.name]
      let output: unknown
      try {
        output = impl
          ? await impl(call.arguments ?? {})
          : { error: `Herramienta desconocida: ${call.name}` }
      } catch (err: any) {
        // Surfaced to the model rather than thrown: it can retry with different
        // arguments, where a thrown error loses the whole generation.
        output = { error: String(err?.message ?? err) }
      }
      messages.push({ role: 'tool', content: JSON.stringify(output), toolCallId: call.id })
    }
  }

  if (totalUsage.totalTokens > 0) {
    await recordAiInteraction({
      userId: options.userId,
      contextType: options.contextType,
      content,
      usage: totalUsage,
      model: provider.model
    })
  }

  return {
    content,
    model: provider.model,
    tokensUsed: totalUsage.totalTokens,
    usage: totalUsage
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
