import OpenAI from 'openai'
import { AI_MODEL, AI_PROVIDER, AI_REASONING_EFFORT } from './ai-config'

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
}

export interface GenerateResult {
  /** Final text content, or null when the model only requested tool calls. */
  text: string | null
  toolCalls: ToolCall[]
  totalTokens: number
}

/** Incremental output from `generateStream`. */
export type StreamEvent =
  | { type: 'text'; delta: string }
  /** Emitted once at the end of the stream, if the model requested any tools. */
  | { type: 'toolCalls'; toolCalls: ToolCall[] }
  | { type: 'usage'; totalTokens: number }

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

function toOpenAiMessages(messages: ChatMessage[]): any[] {
  return messages.map(m => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
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

class OpenAiCompatibleProvider implements AiProvider {
  readonly model = AI_MODEL
  private client: OpenAI

  constructor(apiKey: string, baseURL?: string, defaultHeaders?: Record<string, string>) {
    this.client = new OpenAI({ apiKey, ...(baseURL && { baseURL }), ...(defaultHeaders && { defaultHeaders }) })
  }

  /** Request body shared by the buffered and streaming paths. */
  private buildRequest(messages: ChatMessage[], options: GenerateOptions) {
    return {
      model: this.model,
      messages: toOpenAiMessages(messages),
      ...(options.maxOutputTokens && { max_completion_tokens: options.maxOutputTokens }),
      ...(options.jsonMode && { response_format: { type: 'json_object' as const } }),
      ...(AI_REASONING_EFFORT && { reasoning_effort: AI_REASONING_EFFORT }),
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
    const completion = await this.client.chat.completions.create({
      ...this.buildRequest(messages, options),
      stream: false
    })

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
      totalTokens: completion.usage?.total_tokens ?? 0
    }
  }

  async *generateStream(messages: ChatMessage[], options: GenerateOptions = {}): AsyncGenerator<StreamEvent> {
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
    let totalTokens = 0

    for await (const chunk of stream) {
      // The usage-only chunk arrives last and carries no choices.
      if (chunk.usage?.total_tokens) totalTokens = chunk.usage.total_tokens

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

    if (totalTokens > 0) yield { type: 'usage', totalTokens }
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
