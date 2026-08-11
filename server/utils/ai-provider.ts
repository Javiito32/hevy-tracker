import OpenAI from 'openai'
import { AI_MODEL, AI_PROMPT_CACHE, AI_PROVIDER, type ReasoningEffort } from './ai-config'

/**
 * Provider-agnostic LLM layer.
 *
 * All AI endpoints talk to the `AiProvider` interface below using neutral
 * message/tool shapes. Two adapters ship today:
 *  - 'openrouter' (default): OpenAI-compatible API that routes to any vendor
 *    (Anthropic, OpenAI, Google…). Model is selected via the OpenRouter slug
 *    in AI_MODEL. Key: OPENROUTER_API_KEY.
 *  - 'openai': direct OpenAI API. Key: OPENAI_API_KEY.
 * Swapping vendors = changing AI_PROVIDER + AI_MODEL in ai-config.ts.
 */

// ── Neutral types ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Present on assistant messages that requested tool calls. */
  toolCalls?: ToolCall[]
  /** Present on 'tool' messages: the id of the call this result answers. */
  toolCallId?: string
}

export interface ToolCall {
  id: string
  name: string
  /** Parsed arguments object. Invalid JSON from the model becomes {}. */
  arguments: Record<string, any>
}

export interface ToolDefinition {
  name: string
  description: string
  /** Plain JSON Schema (object). Keep it simple: no vendor-specific extensions. */
  parameters: Record<string, any>
}

export interface GenerateOptions {
  maxOutputTokens?: number
  /** Ask the model to emit a single JSON object. */
  jsonMode?: boolean
  tools?: ToolDefinition[]
  /** 'auto' lets the model decide; 'none' forbids tool calls (used to force a final answer). */
  toolChoice?: 'auto' | 'none'
  /**
   * Reasoning effort for this call. Per call, not per process: reasoning is
   * billed as output, and a chat turn that reads back the context it was given
   * should not think as hard as the one designing a mesocycle.
   * `null`/undefined omits the parameter entirely.
   */
  reasoningEffort?: ReasoningEffort | null
  /**
   * Mark the system message as a cache breakpoint, so a provider that supports
   * prompt caching can reuse the prefix (tool definitions + system prompt) on
   * the next call. Only worth setting where that prefix is stable and re-sent —
   * see AI_PROMPT_CACHE in ai-config.ts.
   */
  cachePrefix?: boolean
}

/**
 * Token usage of one provider call.
 *
 * The in/out split is what makes cost accounting possible: output tokens are
 * several times more expensive than input ones, so a single total can't be
 * priced. `totalTokens` is kept as its own field rather than derived, because
 * providers may bill extras (reasoning tokens) that aren't in either bucket.
 *
 * The two detail fields are **null when the provider didn't report them**, and
 * are never inferred. A cached-token count of 0 and "this provider doesn't tell
 * us about caching" are different facts, and only one of them is evidence that
 * caching isn't working.
 */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /**
   * Input tokens served from the provider's prompt cache. Part of
   * `inputTokens`, not additional to it — they are billed at a reduced rate,
   * which is why cost has to subtract them out rather than add them on.
   */
  cachedInputTokens: number | null
  /** Output tokens spent on the reasoning block. Part of `outputTokens`. */
  reasoningTokens: number | null
}

export interface GenerateResult {
  /** Final text content, or null when the model only requested tool calls. */
  text: string | null
  toolCalls: ToolCall[]
  usage: TokenUsage
  /** Wall-clock time of this single provider call. */
  latencyMs: number
}

/** Incremental output from `generateStream`. */
export type StreamEvent =
  | { type: 'text'; delta: string }
  /** Emitted once at the end of the stream, if the model requested any tools. */
  | { type: 'toolCalls'; toolCalls: ToolCall[] }
  /** Emitted once the stream closes: usage plus how long the call took. */
  | { type: 'usage'; usage: TokenUsage; latencyMs: number }

export interface AiProvider {
  readonly model: string
  generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult>
  /**
   * Same contract as `generate`, delivered incrementally. Text arrives as
   * `text` deltas; tool calls are buffered and emitted as a single `toolCalls`
   * event once complete (arguments stream in fragments and are unusable until
   * the stream closes).
   */
  generateStream(messages: ChatMessage[], options?: GenerateOptions): AsyncGenerator<StreamEvent>
}

export interface AiKeys {
  openaiApiKey?: string
  openrouterApiKey?: string
}

// ── OpenAI-compatible adapter (OpenAI direct + OpenRouter) ─────────────────────

function toOpenAiMessages(messages: ChatMessage[], cachePrefix = false): any[] {
  return messages.map((m, index) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    }
    // Prompt-cache breakpoint on the system message. Anthropic (through
    // OpenRouter) caches everything up to and including the marked block, which
    // is tools + system — exactly the prefix every tool round re-sends
    // unchanged. Providers that cache automatically ignore the field.
    if (m.role === 'system' && cachePrefix && index === 0) {
      return {
        role: 'system',
        content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }]
      }
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      }
    }
    return { role: m.role, content: m.content }
  })
}

/** Model never returns valid JSON args for a call → fall back to {} (as generate does). */
function parseToolArguments(raw: string | undefined): Record<string, any> {
  try { return JSON.parse(raw || '{}') } catch { return {} }
}

/** How long a single provider call may take before the SDK aborts it. */
const REQUEST_TIMEOUT_MS = 20 * 60 * 1000

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: null,
  reasoningTokens: null
}

/**
 * Reads the OpenAI-compatible `usage` block into neutral shape.
 *
 * The two `*_details` sub-objects are optional in the spec and absent from
 * several providers, so they are read as "unknown" rather than as zero: a 0
 * cached-token count is a claim that the cache missed, and inventing it would
 * make a provider that says nothing look like one whose cache never works.
 */
function toTokenUsage(usage: any): TokenUsage {
  const cached = usage?.prompt_tokens_details?.cached_tokens
  const reasoning = usage?.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    cachedInputTokens: typeof cached === 'number' ? cached : null,
    reasoningTokens: typeof reasoning === 'number' ? reasoning : null
  }
}

/** null + null stays null; a number on either side makes the sum a number. */
function addOptional(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null
  return (a ?? 0) + (b ?? 0)
}

/**
 * Sums two usages. A chat turn can chain several provider calls (one per
 * tool-call round) and every one of them is billed, so the turn's cost is the
 * sum — not the usage of the last call.
 */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    cachedInputTokens: addOptional(a.cachedInputTokens, b.cachedInputTokens),
    reasoningTokens: addOptional(a.reasoningTokens, b.reasoningTokens)
  }
}

class OpenAiCompatibleProvider implements AiProvider {
  readonly model = AI_MODEL
  private client: OpenAI

  constructor(apiKey: string, baseURL?: string, defaultHeaders?: Record<string, string>) {
    this.client = new OpenAI({
      apiKey,
      ...(baseURL && { baseURL }),
      ...(defaultHeaders && { defaultHeaders }),
      // The SDK defaults to 10 minutes, which a buffered plan generation can
      // exceed: a whole mesocycle is tens of thousands of tokens of reasoning
      // and JSON, emitted in one non-streaming response. A client timeout there
      // aborts a request the provider bills in full and then retries it.
      timeout: REQUEST_TIMEOUT_MS
    })
  }

  /** Request body shared by the buffered and streaming paths. */
  private buildRequest(messages: ChatMessage[], options: GenerateOptions) {
    return {
      model: this.model,
      messages: toOpenAiMessages(messages, AI_PROMPT_CACHE && options.cachePrefix === true),
      ...(options.maxOutputTokens && { max_completion_tokens: options.maxOutputTokens }),
      ...(options.jsonMode && { response_format: { type: 'json_object' as const } }),
      ...(options.reasoningEffort && { reasoning_effort: options.reasoningEffort }),
      ...(options.tools?.length && {
        tools: options.tools.map(t => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters }
        })),
        tool_choice: options.toolChoice === 'none' ? 'none' as const : 'auto' as const
      })
    }
  }

  async generate(messages: ChatMessage[], options: GenerateOptions = {}): Promise<GenerateResult> {
    const startedAt = Date.now()
    const completion = await this.client.chat.completions.create({
      ...this.buildRequest(messages, options),
      stream: false
    })
    const latencyMs = Date.now() - startedAt

    const choice = completion.choices[0]
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? [])
      .filter((tc: any) => tc.type === 'function')
      .map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: parseToolArguments(tc.function.arguments)
      }))

    return {
      text: choice?.message?.content ?? null,
      toolCalls,
      usage: toTokenUsage(completion.usage),
      latencyMs
    }
  }

  async *generateStream(messages: ChatMessage[], options: GenerateOptions = {}): AsyncGenerator<StreamEvent> {
    const startedAt = Date.now()
    const stream = await this.client.chat.completions.create({
      ...this.buildRequest(messages, options),
      stream: true,
      // Usage is omitted from streamed responses unless asked for; without it
      // token accounting for the admin stats would read 0 on every chat turn.
      stream_options: { include_usage: true }
    })

    // Tool calls arrive as fragments: the id and name land on the first chunk for
    // a given `index`, then `arguments` accumulates character by character across
    // later chunks. Buffer per index and parse once the stream is done.
    const pending = new Map<number, { id: string; name: string; args: string }>()
    let usage: TokenUsage | null = null

    for await (const chunk of stream) {
      // The usage-only chunk arrives last and carries no choices.
      if (chunk.usage) usage = toTokenUsage(chunk.usage)

      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) yield { type: 'text', delta: delta.content }

      for (const tc of delta.tool_calls ?? []) {
        const slot = pending.get(tc.index) ?? { id: '', name: '', args: '' }
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name = tc.function.name
        if (tc.function?.arguments) slot.args += tc.function.arguments
        pending.set(tc.index, slot)
      }
    }

    if (pending.size > 0) {
      const toolCalls: ToolCall[] = [...pending.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, slot]) => ({ id: slot.id, name: slot.name, arguments: parseToolArguments(slot.args) }))
        .filter(tc => tc.name)
      if (toolCalls.length) yield { type: 'toolCalls', toolCalls }
    }

    if (usage && usage.totalTokens > 0) yield { type: 'usage', usage, latencyMs: Date.now() - startedAt }
  }
}

// ── Factory ────────────────────────────────────────────────────────────────────

function isValidKey(key: string | undefined): key is string {
  return !!key && !key.includes('your_')
}

export function isAiConfigured(keys: AiKeys): boolean {
  return AI_PROVIDER === 'openrouter'
    ? isValidKey(keys.openrouterApiKey)
    : isValidKey(keys.openaiApiKey)
}

/**
 * Returns the configured provider, or throws a 503 when the API key is missing.
 * New vendors: add a case here and switch AI_PROVIDER in ai-config.ts.
 */
export function createAiProvider(keys: AiKeys): AiProvider {
  if (!isAiConfigured(keys)) {
    throw createError({ statusCode: 503, statusMessage: 'AI API Key no configurada' })
  }
  switch (AI_PROVIDER) {
    case 'openrouter':
      return new OpenAiCompatibleProvider(keys.openrouterApiKey!, 'https://openrouter.ai/api/v1', {
        'HTTP-Referer': 'https://htracker.javiito.com',
        'X-Title': 'HevyTracker AI'
      })
    case 'openai':
      return new OpenAiCompatibleProvider(keys.openaiApiKey!)
    default:
      throw createError({ statusCode: 500, statusMessage: `Proveedor de IA desconocido: ${AI_PROVIDER}` })
  }
}
