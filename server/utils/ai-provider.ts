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
  /**
   * System messages only. When set, this is the **stable** half of the prompt
   * and `content` is the dynamic half that follows it; the two travel as two
   * text blocks and the cache breakpoint goes on this one. See `cachePrefix`.
   */
  stableContent?: string
  /** Present on assistant messages that requested tool calls. */
  toolCalls?: ToolCall[]
  /** Present on 'tool' messages: the id of the call this result answers. */
  toolCallId?: string
  /**
   * The model's own reasoning blocks, exactly as the provider returned them.
   *
   * Replayed verbatim on the next call of the same turn. Anthropic (and every
   * other reasoning model routed through OpenRouter) requires that "the entire
   * sequence of consecutive reasoning blocks must match the outputs generated
   * by the model during the original request" — a tool round that drops them
   * makes the model re-derive, from scratch, the thinking it already billed for,
   * and on signature-carrying models the block cannot be reconstructed at all.
   *
   * Never synthesised, never reshaped: this is the provider's array, passed
   * through. Absent (not empty) on models that don't emit reasoning, and the
   * field is then omitted from the request entirely.
   */
  reasoningDetails?: ReasoningDetail[]
}

/**
 * One reasoning block as OpenRouter returns it.
 *
 * The three documented variants are `reasoning.text` (raw thinking, optionally
 * signed), `reasoning.summary` (a provider-written précis) and
 * `reasoning.encrypted` (opaque, sometimes literally `[REDACTED]`). The fields
 * are typed as optional rather than as a discriminated union on purpose: the
 * value is stored and echoed back **as received**, so a variant or a field this
 * app has never heard of survives the round trip instead of being stripped by a
 * narrower type.
 */
export interface ReasoningDetail {
  type: string
  id?: string | null
  format?: string
  index?: number
  /** `reasoning.text` */
  text?: string
  /** Verifies `text` with the upstream provider; must travel with it. */
  signature?: string | null
  /** `reasoning.summary` */
  summary?: string
  /** `reasoning.encrypted` */
  data?: string
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
   * Place a cache breakpoint at the end of the **stable** part of the prompt,
   * so a provider that supports prompt caching can reuse it on the next call.
   *
   * The breakpoint lands after the tool definitions and `stableContent`, and
   * **before** the system message's dynamic half — which is the whole point: a
   * breakpoint that sits after the athlete's weight caches a prefix that
   * changes whenever the athlete does, and is then written and never read. Only
   * worth setting where the stable part really is re-sent — see AI_PROMPT_CACHE
   * in ai-config.ts.
   */
  cachePrefix?: boolean
  /**
   * Groups related calls for the provider's sticky routing, so consecutive
   * turns of one conversation land on the provider instance that already holds
   * the cached prefix. OpenRouter-only (`session_id`); ignored elsewhere.
   */
  sessionId?: string
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
  /**
   * Input tokens **written** to the provider's cache by this call. Also part of
   * `inputTokens`, and disjoint from `cachedInputTokens` — a token is either
   * read from the cache or written to it, never both. Anthropic bills a write
   * at 1.25× the input rate and a read at 0.1×, so the two cannot share a
   * counter and a cache that is written but never read is a cost *increase*,
   * which is exactly the failure this field exists to make visible.
   */
  cacheWriteTokens: number | null
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
  /** The model's reasoning blocks, to be replayed on the next call. */
  reasoningDetails?: ReasoningDetail[]
}

/** Incremental output from `generateStream`. */
export type StreamEvent =
  | { type: 'text'; delta: string }
  /** Emitted once at the end of the stream, if the model requested any tools. */
  | { type: 'toolCalls'; toolCalls: ToolCall[] }
  /**
   * Emitted once at the end, if the model reasoned. Reassembled from the
   * fragments the deltas carry — a half-block is not replayable, so this is not
   * streamed incrementally.
   */
  | { type: 'reasoningDetails'; reasoningDetails: ReasoningDetail[] }
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

/**
 * Neutral messages → OpenAI-compatible request body.
 *
 * Exported because it is where three guarantees this app relies on actually
 * happen — the cache breakpoint's position, the replay of `reasoning_details`,
 * and the omission of both when they don't apply — and each of those is a
 * property of the emitted JSON, not of anything observable further up.
 */
export function toOpenAiMessages(messages: ChatMessage[], cachePrefix = false): any[] {
  return messages.map((m, index) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    }

    // The system message travels as two text blocks when the caller separated
    // them: [stable][dynamic]. Anthropic (through OpenRouter) caches everything
    // up to and including the marked block, so the breakpoint on block 0 covers
    // tool definitions + the stable half and stops short of the athlete's data.
    // Marking the whole message instead — which is what this did — declares a
    // prefix that changes every time the athlete weighs themselves, so the
    // cache is written on every turn and read on none of them.
    if (m.role === 'system' && m.stableContent) {
      const stable: Record<string, unknown> = { type: 'text', text: m.stableContent }
      if (cachePrefix && index === 0) stable.cache_control = { type: 'ephemeral' }
      const content: Array<Record<string, unknown>> = [stable]
      if (m.content) content.push({ type: 'text', text: m.content })
      return { role: 'system', content }
    }
    // No split: the whole system message is the stable part.
    if (m.role === 'system' && cachePrefix && index === 0) {
      return {
        role: 'system',
        content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }]
      }
    }

    if (m.role === 'assistant' && (m.toolCalls?.length || m.reasoningDetails?.length)) {
      return {
        role: 'assistant',
        content: m.content || null,
        // Reasoning goes back before the tool calls it produced, which is the
        // order the model emitted them in. Omitted entirely when absent: an
        // empty array is a claim that the model reasoned about nothing, and
        // providers that don't know the field reject it rather than ignore it.
        ...(m.reasoningDetails?.length && { reasoning_details: m.reasoningDetails }),
        ...(m.toolCalls?.length && {
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
          }))
        })
      }
    }
    return { role: m.role, content: m.content }
  })
}

/** The provider's reasoning array, or undefined when it sent none. */
function toReasoningDetails(raw: unknown): ReasoningDetail[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const details = raw.filter((d): d is ReasoningDetail => !!d && typeof d === 'object' && typeof (d as any).type === 'string')
  return details.length ? details : undefined
}

/**
 * Reassembles the reasoning blocks a stream delivered in fragments.
 *
 * A block arrives split across chunks the same way `tool_calls.arguments` does:
 * the type and index land first, then the payload accumulates. Fragments of one
 * block are identified by (`index`, `type`) and their string payload is
 * concatenated; anything without an index is appended in arrival order, which
 * is the order the provider requires them to be replayed in.
 */
function mergeReasoningDelta(accumulated: ReasoningDetail[], incoming: unknown): void {
  for (const detail of toReasoningDetails(incoming) ?? []) {
    const existing = detail.index != null
      ? accumulated.find(d => d.index === detail.index && d.type === detail.type)
      : undefined

    if (!existing) {
      accumulated.push({ ...detail })
      continue
    }
    if (detail.text) existing.text = (existing.text ?? '') + detail.text
    if (detail.summary) existing.summary = (existing.summary ?? '') + detail.summary
    if (detail.data) existing.data = (existing.data ?? '') + detail.data
    // Identity and verification fields arrive whole, on whichever chunk carries
    // them; the last non-empty one wins.
    if (detail.signature) existing.signature = detail.signature
    if (detail.id) existing.id = detail.id
    if (detail.format) existing.format = detail.format
  }
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
  cacheWriteTokens: null,
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
  const number = (value: unknown): number | null => (typeof value === 'number' ? value : null)
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    cachedInputTokens: number(usage?.prompt_tokens_details?.cached_tokens),
    // OpenRouter reports cache writes separately from reads; both are inside
    // `prompt_tokens`. A provider that reports neither leaves both null, and
    // pricing then charges the whole input at the standard rate.
    cacheWriteTokens: number(usage?.prompt_tokens_details?.cache_write_tokens),
    reasoningTokens: number(usage?.completion_tokens_details?.reasoning_tokens)
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
    cacheWriteTokens: addOptional(a.cacheWriteTokens, b.cacheWriteTokens),
    reasoningTokens: addOptional(a.reasoningTokens, b.reasoningTokens)
  }
}

/**
 * The streaming reassembly above, over a whole sequence of deltas.
 *
 * Same code path the adapter uses; exported so the fragment handling can be
 * checked without a live stream, since a block reassembled wrongly is one the
 * provider rejects on the next round.
 */
export function reassembleStreamedReasoning(deltas: unknown[]): ReasoningDetail[] {
  const accumulated: ReasoningDetail[] = []
  for (const delta of deltas) mergeReasoningDelta(accumulated, delta)
  return accumulated
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
      // OpenRouter only. It is the sticky-routing key: without it the router is
      // free to send the next turn of a conversation to a different provider
      // instance, which holds none of the prefix this turn just paid to cache.
      // Sent as a body field the direct OpenAI API would reject, hence the guard.
      ...(options.sessionId && AI_PROVIDER === 'openrouter' && { session_id: options.sessionId.slice(0, 256) }),
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

    const reasoningDetails = toReasoningDetails((choice?.message as any)?.reasoning_details)

    return {
      text: choice?.message?.content ?? null,
      toolCalls,
      usage: toTokenUsage(completion.usage),
      latencyMs,
      ...(reasoningDetails && { reasoningDetails })
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
    // Reasoning arrives in fragments too, and is worth just as little in
    // pieces: a partial block cannot be replayed on the next round.
    const reasoning: ReasoningDetail[] = []
    let usage: TokenUsage | null = null

    for await (const chunk of stream) {
      // The usage-only chunk arrives last and carries no choices.
      if (chunk.usage) usage = toTokenUsage(chunk.usage)

      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) yield { type: 'text', delta: delta.content }

      mergeReasoningDelta(reasoning, (delta as any).reasoning_details)

      for (const tc of delta.tool_calls ?? []) {
        const slot = pending.get(tc.index) ?? { id: '', name: '', args: '' }
        if (tc.id) slot.id = tc.id
        if (tc.function?.name) slot.name = tc.function.name
        if (tc.function?.arguments) slot.args += tc.function.arguments
        pending.set(tc.index, slot)
      }
    }

    // Before the tool calls, so a consumer that stops at the first event it
    // cares about still sees the reasoning that produced them.
    if (reasoning.length) yield { type: 'reasoningDetails', reasoningDetails: reasoning }

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
