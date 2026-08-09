/**
 * Central AI configuration. Everything model-specific lives here so that
 * swapping vendors or models is a one-file change.
 */

/** Provider adapter to use. See `createAiProvider` in ai-provider.ts. */
export const AI_PROVIDER: 'openai' | 'openrouter' = 'openrouter'

/**
 * Model ID. With the OpenRouter provider, use the OpenRouter slug
 * (e.g. 'anthropic/claude-sonnet-5', 'openai/gpt-5.6-sol', 'anthropic/claude-opus-5').
 * With the direct OpenAI provider, use the plain OpenAI model id.
 */
export const AI_MODEL = 'anthropic/claude-sonnet-5'

/**
 * Reasoning effort for models that support it. OpenRouter normalizes this
 * across vendors (maps to thinking budget on Anthropic, reasoning_effort on
 * OpenAI, etc.). Set to null to omit it entirely.
 */
export const AI_REASONING_EFFORT: 'low' | 'medium' | 'high' | null = 'medium'

/** Max chained tool-call rounds in the chat endpoint before forcing a final answer. */
export const MAX_TOOL_ITERATIONS = 5

/** Chat history window (messages) loaded from DB for each chat turn. */
export const CHAT_HISTORY_WINDOW = 8

/**
 * Output token caps per task type.
 *
 * On models with reasoning, this budget is spent on the reasoning block *before*
 * the answer begins — AI_REASONING_EFFORT allocates a fraction of it — so a cap
 * sized to the visible answer alone truncates the answer, or the reasoning that
 * precedes it. For a JSON task that means an unparseable object or an empty
 * string, neither of which the athlete can act on.
 */
export const MAX_OUTPUT_TOKENS = {
  chat: 16000,
  analysis: 16000,
  finalSummary: 24000,
  /** Small structured payloads (nutrition targets: 5 numbers and a rationale). */
  generation: 16000,
  /**
   * A whole mesocycle as JSON: every week, plus every session with all its
   * exercises. Five training days of six exercises is ~3k tokens of object on
   * its own — the rest of this budget is the reasoning that precedes it.
   */
  planGeneration: 48000
} as const

/**
 * Cap applied to the intermediate rounds of a tool-calling task, instead of the
 * task's own (larger) budget.
 *
 * **A round must be able to finish reasoning and still emit its tool call.**
 * This was set to 4000 to save tokens and did the opposite: the model spent the
 * whole allowance thinking, got cut off before the call, and the loop exited
 * with no tool result and no text — a full generation's cost for an empty
 * response. The budget bounds the round; it must never be what ends it.
 */
export const TOOL_ROUND_MAX_OUTPUT_TOKENS = 16000
