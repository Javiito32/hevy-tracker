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

export interface AiProvider {
  readonly model: string
  generate(messages: ChatMessage[], options?: GenerateOptions): Promise<GenerateResult>
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

class OpenAiCompatibleProvider implements AiProvider {
  readonly model = AI_MODEL
  private client: OpenAI

  constructor(apiKey: string, baseURL?: string, defaultHeaders?: Record<string, string>) {
    this.client = new OpenAI({ apiKey, ...(baseURL && { baseURL }), ...(defaultHeaders && { defaultHeaders }) })
  }

  async generate(messages: ChatMessage[], options: GenerateOptions = {}): Promise<GenerateResult> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: toOpenAiMessages(messages),
      ...(options.maxOutputTokens && { max_completion_tokens: options.maxOutputTokens }),
      ...(options.jsonMode && { response_format: { type: 'json_object' } }),
      ...(AI_REASONING_EFFORT && { reasoning_effort: AI_REASONING_EFFORT }),
      ...(options.tools?.length && {
        tools: options.tools.map(t => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters }
        })),
        tool_choice: options.toolChoice === 'none' ? 'none' : 'auto'
      })
    })

    const choice = completion.choices[0]
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? [])
      .filter((tc: any) => tc.type === 'function')
      .map((tc: any) => {
        let args: Record<string, any> = {}
        try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* keep {} */ }
        return { id: tc.id, name: tc.function.name, arguments: args }
      })

    return {
      text: choice?.message?.content ?? null,
      toolCalls,
      totalTokens: completion.usage?.total_tokens ?? 0
    }
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
        'HTTP-Referer': 'https://hevy-tracker.local',
        'X-Title': 'HevyTracker AI'
      })
    case 'openai':
      return new OpenAiCompatibleProvider(keys.openaiApiKey!)
    default:
      throw createError({ statusCode: 500, statusMessage: `Proveedor de IA desconocido: ${AI_PROVIDER}` })
  }
}
