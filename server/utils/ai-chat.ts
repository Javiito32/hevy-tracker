import { buildLeanSystemPrompt } from './ai-context'
import { executeTool, selectChatTools } from './ai-tools'
import { prisma } from './prisma'
import { CHAT_HISTORY_WINDOW, MAX_OUTPUT_TOKENS, MAX_TOOL_ITERATIONS, REASONING_BY_TASK } from './ai-config'
import { addUsage, createAiProvider, EMPTY_USAGE, type AiProvider, type AiKeys, type ChatMessage, type TokenUsage } from './ai-provider'
import { logAiCall, usageColumns, type AiCallMetrics } from './ai-service'
import { CHAT_CONTEXT_TYPE, deriveConversationTitle } from './conversations'

/**
 * Shared chat turn runner for both `/api/chat` (buffered) and
 * `/api/chat/stream` (SSE). Owns the tool-call loop, persistence and the
 * conversation's activity timestamp so the two endpoints can't drift apart.
 */

export type ChatTurnEvent =
  /** A tool is about to run. Drives the "what is the coach doing" indicator. */
  | { type: 'tool'; name: string }
  /** A fragment of the final answer. Only emitted when `stream` is true. */
  | { type: 'delta'; text: string }

export interface ChatTurnOptions {
  userId: string
  /** Existing conversation to append to, or null to start a new one. */
  conversationId: string | null
  message: string
  keys: AiKeys
  /** Stream the reply as `delta` events instead of returning it in one piece. */
  stream?: boolean
  onEvent?: (event: ChatTurnEvent) => void | Promise<void>
  /** Injectable for tests; defaults to the configured provider. */
  provider?: AiProvider
}

export interface ChatTurnResult {
  conversationId: string
  reply: string
  model: string
  title: string | null
  /** Summed across every provider call the turn made (one per tool-call round). */
  usage: TokenUsage
  toolsInvoked: string[]
  /** Latency, rounds and calls — persisted and logged, see ai-service.ts. */
  metrics: AiCallMetrics
}

/**
 * Resolves the conversation to write to, creating one when the client sent null.
 *
 * A null id always means "start a new conversation". The previous behaviour —
 * falling back to the user's OLDEST conversation — is what made /chat reopen an
 * old thread and silently append new messages to it.
 */
async function resolveConversation(userId: string, conversationId: string | null): Promise<string> {
  if (conversationId) {
    const owned = await prisma.aiConversation.findFirst({
      where: { id: conversationId, user_id: userId, context_type: CHAT_CONTEXT_TYPE },
      select: { id: true }
    })
    if (!owned) throw createError({ statusCode: 404, statusMessage: 'Conversación no encontrada' })
    return owned.id
  }

  const created = await prisma.aiConversation.create({
    data: { user_id: userId, context_type: CHAT_CONTEXT_TYPE },
    select: { id: true }
  })
  return created.id
}

export async function runChatTurn(options: ChatTurnOptions): Promise<ChatTurnResult> {
  const { userId, message, keys, stream = false, onEvent } = options
  const emit = async (event: ChatTurnEvent) => { await onEvent?.(event) }

  const convoId = await resolveConversation(userId, options.conversationId)

  // History comes from the DB (the server owns the transcript), loaded BEFORE
  // persisting the incoming message so it isn't duplicated in the prompt.
  const recentMessages = await prisma.aiMessage.findMany({
    where: { conversation_id: convoId, role: { in: ['user', 'assistant'] } },
    orderBy: { created_at: 'desc' },
    take: CHAT_HISTORY_WINDOW,
    select: { role: true, content: true }
  })
  const history: ChatMessage[] = recentMessages
    .reverse()
    .filter(m => m.content)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const isFirstTurn = history.length === 0

  await prisma.aiMessage.create({
    data: { conversation_id: convoId, role: 'user', content: message }
  })

  const provider = options.provider ?? createAiProvider(keys)
  const systemPrompt = await buildLeanSystemPrompt(userId)

  // Chosen once, from this turn's message, and held for every round below: a
  // tool set that changed mid-turn would invalidate the cached prefix on each
  // round, which costs more than the definitions it drops.
  const tools = selectChatTools(message)

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message }
  ]

  const toolsInvoked: string[] = []
  // Every iteration of the loop below is a separate billed provider call, so
  // usage accumulates across them rather than being overwritten.
  let usage: TokenUsage = EMPTY_USAGE
  let finalReply: string | null = null
  let latencyMs = 0
  let toolRounds = 0

  try {
    for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
      // On the last iteration, forbid tool calls so the model must answer
      // with whatever data it has gathered instead of erroring out.
      const isLastIteration = i === MAX_TOOL_ITERATIONS
      const generateOptions = {
        tools,
        toolChoice: isLastIteration ? 'none' as const : 'auto' as const,
        maxOutputTokens: MAX_OUTPUT_TOKENS.chat,
        reasoningEffort: REASONING_BY_TASK.chat,
        // The prefix (tool definitions + system prompt) is re-sent verbatim on
        // every round of this turn and on every turn of the conversation, which
        // is the case prompt caching exists for.
        cachePrefix: true
      }

      let text: string | null = null
      let toolCalls: Awaited<ReturnType<typeof provider.generate>>['toolCalls'] = []

      if (stream) {
        // Buffer text locally as it streams: it goes to the client immediately,
        // but the loop still needs the whole string for the transcript and to
        // replay the assistant turn back to the model alongside tool results.
        let buffered = ''
        for await (const event of provider.generateStream(messages, generateOptions)) {
          if (event.type === 'text') {
            buffered += event.delta
            await emit({ type: 'delta', text: event.delta })
          } else if (event.type === 'toolCalls') {
            toolCalls = event.toolCalls
          } else if (event.type === 'usage') {
            usage = addUsage(usage, event.usage)
            latencyMs += event.latencyMs
          }
        }
        text = buffered || null
      } else {
        const result = await provider.generate(messages, generateOptions)
        text = result.text
        toolCalls = result.toolCalls
        usage = addUsage(usage, result.usage)
        latencyMs += result.latencyMs
      }

      if (import.meta.dev) console.log(`[chat] iteration=${i} tool_calls=${toolCalls.length} tokens=${usage.totalTokens} (in=${usage.inputTokens} out=${usage.outputTokens})`)

      if (toolCalls.length === 0) {
        finalReply = text || 'Lo siento, no pude generar una respuesta.'
        break
      }

      toolRounds++
      messages.push({ role: 'assistant', content: text ?? '', toolCalls })
      for (const call of toolCalls) {
        if (import.meta.dev) console.log(`[chat] tool_call: ${call.name}`, JSON.stringify(call.arguments))
        toolsInvoked.push(call.name)
        await emit({ type: 'tool', name: call.name })
        // Tools answer in text (see ai-tools.ts); it goes to the model as it is,
        // since JSON-encoding a table only adds escapes to pay for.
        const toolResult = await executeTool(call.name, userId, call.arguments)
        if (import.meta.dev) console.log(`[chat] tool_result: ${call.name} → ${toolResult.slice(0, 120)}...`)
        messages.push({ role: 'tool', toolCallId: call.id, content: toolResult })
      }
    }
  } catch (error) {
    // The user message is already persisted; leave the conversation coherent by
    // bumping its activity so it doesn't sink in the sidebar with a dangling turn.
    await prisma.aiConversation.update({
      where: { id: convoId },
      data: { updated_at: new Date(), ...(isFirstTurn && { title: deriveConversationTitle(message) }) }
    }).catch(() => { /* the original error matters more */ })
    throw error
  }

  if (!finalReply) {
    finalReply = 'No pude completar la consulta — se alcanzó el límite de herramientas encadenadas.'
  }

  const metrics: AiCallMetrics = { latencyMs, toolRounds, toolCalls: toolsInvoked.length }

  await prisma.aiMessage.create({
    data: {
      conversation_id: convoId,
      role: 'assistant',
      content: finalReply,
      ...usageColumns(usage, metrics),
      model_used: provider.model
    }
  })

  logAiCall(CHAT_CONTEXT_TYPE, provider.model, usage, metrics)

  const title = isFirstTurn ? deriveConversationTitle(message) : null
  const updated = await prisma.aiConversation.update({
    where: { id: convoId },
    data: { updated_at: new Date(), ...(title && { title }) },
    select: { title: true }
  })

  return {
    conversationId: convoId,
    reply: finalReply,
    model: provider.model,
    title: updated.title,
    usage,
    toolsInvoked,
    metrics
  }
}
