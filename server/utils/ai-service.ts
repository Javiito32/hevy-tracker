import { prisma } from './prisma'
import { addUsage, createAiProvider, EMPTY_USAGE, type AiProvider, type AiKeys, type TokenUsage, type ToolDefinition, type ChatMessage } from './ai-provider'
import { REASONING_BY_TASK, TOOL_ROUND_MAX_OUTPUT_TOKENS, type AiTask } from './ai-config'

/** Extracts the AI provider keys from Nuxt's runtime config. */
export function aiKeysFromConfig(config: { openaiApiKey?: string; openrouterApiKey?: string }): AiKeys {
  return { openaiApiKey: config.openaiApiKey, openrouterApiKey: config.openrouterApiKey }
}

/**
 * Shared runner for the stateless analysis/generation endpoints.
 *
 * Pattern: system prompt = persona + rules + instructions (no data);
 * user message = the task document with all the athlete's data.
 * Usage accounting is persisted to AiConversation/AiMessage for the admin stats.
 */

interface AiTaskOptions {
  keys: AiKeys
  userId: string
  /**
   * Which task this is. Selects the reasoning effort (see REASONING_BY_TASK)
   * and is stored verbatim as `AiConversation.context_type`, which is what the
   * admin analytics groups by — one identifier, so a task can't be configured
   * under one name and reported under another.
   */
  task: AiTask
  systemPrompt: string
  /**
   * The data, already serialized. A string is sent as-is (the compact documents
   * from `ai-serialize.ts`); anything else is JSON — still the right shape for
   * a payload that is genuinely a nested object.
   */
  payload: unknown
  maxOutputTokens: number
  jsonMode?: boolean
  /** Injectable for tests; defaults to the configured provider. */
  provider?: AiProvider
  /**
   * Optional tools. Stateless tasks are one-shot by default, but the plan
   * generator needs to look up real exercise ids mid-task — the catalogue is
   * too large to inline and inventing ids produces plans that fail on push.
   */
  tools?: ToolDefinition[]
  toolImpls?: Record<string, (args: any) => Promise<unknown>>
  /** Rounds of tool calls before the model is forced to answer. */
  maxToolIterations?: number
  /**
   * Called after each round of tool calls, with the 1-based round number.
   * Lets a long task report where it is; a generation that takes minutes with
   * no sign of life is indistinguishable from one that hung.
   */
  onToolRound?: (round: number, toolNames: string[]) => Promise<void>
}

interface AiTaskResult {
  content: string
  model: string
  tokensUsed: number
  usage: TokenUsage
  /** How the answer was produced, for the admin panel and the logs. */
  metrics: AiCallMetrics
}

/**
 * What a completed AI task cost beyond its tokens.
 *
 * Persisted next to the usage so "why was this call expensive / slow" is
 * answerable after the fact: a task that spent four rounds looking things up is
 * a different problem from one that reasoned for 40 s in a single call, and the
 * token total alone cannot tell them apart.
 */
export interface AiCallMetrics {
  latencyMs: number
  toolRounds: number
  toolCalls: number
}

export async function runAiTask(options: AiTaskOptions): Promise<AiTaskResult> {
  const provider = options.provider ?? createAiProvider(options.keys)

  const messages: ChatMessage[] = [
    { role: 'system', content: options.systemPrompt },
    {
      role: 'user',
      content: typeof options.payload === 'string'
        ? options.payload
        : JSON.stringify(options.payload, null, 2)
    }
  ]

  const usesTools = Boolean(options.tools?.length && options.toolImpls)
  const maxIterations = usesTools ? (options.maxToolIterations ?? 4) : 1

  // Usage is SUMMED across iterations: each tool round is a separately billed
  // call, so reporting only the last one would undercount the task's cost —
  // the same reason runChatTurn sums.
  let totalUsage: TokenUsage = EMPTY_USAGE
  let content = ''
  let latencyMs = 0
  let toolRounds = 0
  let toolCalls = 0

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const isFinal = iteration === maxIterations - 1
    const result = await provider.generate(messages, {
      // Intermediate rounds emit a tool call, not the answer, so they are capped
      // well below the task's budget — that budget also sizes the reasoning
      // allowance, which is billed as output on every one of them.
      maxOutputTokens: usesTools && !isFinal
        ? Math.min(options.maxOutputTokens, TOOL_ROUND_MAX_OUTPUT_TOKENS)
        : options.maxOutputTokens,
      // The task's own effort on EVERY round, including the intermediate ones.
      // Which round produces the answer isn't knowable in advance — the model
      // stops calling tools when it has what it needs — so lowering the effort
      // on "intermediate" rounds would sooner or later generate the mesocycle
      // itself at the effort meant for choosing a search term. The token cap
      // above is what bounds an intermediate round: the effort is a fraction of
      // `max_tokens`, so capping the round caps its reasoning too.
      reasoningEffort: REASONING_BY_TASK[options.task],
      // JSON mode is withheld until the final turn: a model forced to emit JSON
      // cannot express a tool call, so requesting both at once silently
      // disables the tools.
      jsonMode: options.jsonMode && (!usesTools || isFinal),
      ...(usesTools && {
        tools: options.tools,
        toolChoice: isFinal ? 'none' as const : 'auto' as const
      })
    })

    totalUsage = addUsage(totalUsage, result.usage)
    latencyMs += result.latencyMs
    content = result.text ?? ''

    const calls = result.toolCalls ?? []

    // Neither an answer nor a tool call means the round was cut off — on a
    // reasoning model, almost always the budget spent entirely on thinking.
    // Named here rather than left to fall through: downstream it arrives as an
    // empty response, which reads as "the model said nothing" and sends you
    // looking in the wrong place.
    if (!calls.length && !content.trim()) {
      throw createError({
        statusCode: 502,
        statusMessage: 'La IA agotó su presupuesto de tokens razonando y no llegó a responder. Vuelve a intentarlo; si se repite, hay que subir el límite de tokens.'
      })
    }

    if (!usesTools || calls.length === 0 || isFinal) break

    toolRounds++
    toolCalls += calls.length
    // The assistant turn is replayed with its reasoning attached, in the order
    // the model produced it: reasoning → tool calls → (below) tool results.
    // Dropping the reasoning makes the next round re-think what this one was
    // already billed for, and on models that sign their thinking the block
    // cannot be reconstructed at all — the provider rejects the sequence.
    messages.push({
      role: 'assistant',
      content: result.text ?? '',
      toolCalls: calls,
      ...(result.reasoningDetails?.length && { reasoningDetails: result.reasoningDetails })
    })
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
      // A tool that already answered in text is passed through unchanged:
      // JSON-encoding a table only adds a layer of \n escapes to pay for.
      messages.push({
        role: 'tool',
        content: typeof output === 'string' ? output : JSON.stringify(output),
        toolCallId: call.id
      })
    }

    // Advisory only: a failed progress report must never lose the generation
    // that has already been paid for.
    await options.onToolRound?.(iteration + 1, calls.map(c => c.name)).catch(() => {})
  }

  const metrics: AiCallMetrics = { latencyMs, toolRounds, toolCalls }

  if (totalUsage.totalTokens > 0) {
    await recordAiInteraction({
      userId: options.userId,
      contextType: options.task,
      content,
      usage: totalUsage,
      model: provider.model,
      metrics
    })
  }

  logAiCall(options.task, provider.model, totalUsage, metrics)

  return {
    content,
    model: provider.model,
    tokensUsed: totalUsage.totalTokens,
    usage: totalUsage,
    metrics
  }
}

/**
 * One line per completed AI call, in the server log.
 *
 * Deliberately figures only — no prompt, no answer, no athlete data. The
 * questions it exists to answer ("why was that call expensive, why was it slow,
 * did the cache hit") are all answered by counts, and a log that carried the
 * content would be a copy of the athlete's training and health data sitting in
 * a file with different retention rules from the database.
 */
export function logAiCall(task: string, model: string, usage: TokenUsage, metrics: AiCallMetrics): void {
  console.info(
    `[ai] task=${task} model=${model} in=${usage.inputTokens} out=${usage.outputTokens} ` +
    `total=${usage.totalTokens} cache_read=${usage.cachedInputTokens ?? 'n/d'} ` +
    `cache_write=${usage.cacheWriteTokens ?? 'n/d'} reasoning=${usage.reasoningTokens ?? 'n/d'} ` +
    `latency_ms=${metrics.latencyMs} tool_rounds=${metrics.toolRounds} tool_calls=${metrics.toolCalls}`
  )
}

/**
 * Parses the JSON object a generation task was asked for.
 *
 * `JSON.parse(content || '{}')` is not enough, and its two failure modes are the
 * ones these tasks actually hit:
 *
 *  - `jsonMode` is a **request**, not a guarantee. It maps to the OpenAI-style
 *    `response_format`, which providers that don't implement it (Anthropic
 *    through OpenRouter among them) accept and ignore — so the model answers
 *    with the object inside a ```json fence, or after a line of prose. Both are
 *    the right answer in the wrong wrapper, and both make a bare parse throw.
 *  - An empty string — what a response truncated inside its reasoning block
 *    leaves behind — parses cleanly as `{}` once defaulted. That is how a failed
 *    generation reaches the UI as `success: true` carrying nothing, and the
 *    screen simply doesn't change: no plan, no error, nothing to retry from.
 *
 * So: unwrap what the model actually sent, and fail loudly when there is
 * nothing to unwrap.
 */
export function parseAiJson<T = any>(content: string, task: string): T {
  const text = (content ?? '').trim()
  if (!text) {
    throw createError({
      statusCode: 502,
      statusMessage: `La IA no devolvió ninguna respuesta al ${task}. Suele deberse a que se agotó el límite de tokens; inténtalo de nuevo.`
    })
  }

  for (const candidate of jsonCandidates(text)) {
    try { return JSON.parse(candidate) as T } catch { /* try the next shape */ }
  }

  throw createError({
    statusCode: 502,
    statusMessage: `La IA no devolvió un JSON válido al ${task}. Inténtalo de nuevo.`
  })
}

/** The text as sent, then unfenced, then the outermost {...} in it. */
function* jsonCandidates(text: string): Generator<string> {
  yield text

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) yield fenced[1].trim()

  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) yield text.slice(first, last + 1)
}

export async function recordAiInteraction(args: {
  userId: string
  contextType: string
  content: string
  usage: TokenUsage
  model: string
  metrics?: AiCallMetrics
}): Promise<void> {
  const convo = await prisma.aiConversation.create({
    data: { context_type: args.contextType, user_id: args.userId }
  })
  await prisma.aiMessage.create({
    data: {
      conversation_id: convo.id,
      role: 'assistant',
      content: args.content,
      ...usageColumns(args.usage, args.metrics),
      model_used: args.model
    }
  })
}

/**
 * The usage columns of `AiMessage`, from one `TokenUsage` (+ metrics).
 *
 * Shared by the chat and the stateless tasks so a new field can't be recorded
 * on one path and silently missing on the other — which is precisely how
 * `input_tokens`/`output_tokens` came to exist on some rows and not others.
 *
 * The two detail counters keep their nulls: `?? null` and not `|| null`,
 * because a genuine 0 cached tokens ("the cache missed") is a fact worth
 * storing and is not the same as "this provider never told us".
 */
export function usageColumns(usage: TokenUsage, metrics?: AiCallMetrics) {
  return {
    tokens_used: usage.totalTokens || null,
    input_tokens: usage.inputTokens || null,
    output_tokens: usage.outputTokens || null,
    cached_input_tokens: usage.cachedInputTokens ?? null,
    cache_write_tokens: usage.cacheWriteTokens ?? null,
    reasoning_tokens: usage.reasoningTokens ?? null,
    latency_ms: metrics?.latencyMs ?? null,
    tool_rounds: metrics?.toolRounds ?? null,
    tool_calls: metrics?.toolCalls ?? null
  }
}
