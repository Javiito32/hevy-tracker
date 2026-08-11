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

export type ReasoningEffort = 'low' | 'medium' | 'high'

/**
 * Every AI task in the app. One key per `AiConversation.context_type`, which is
 * also what the admin analytics groups by — so a task cannot be configured
 * under one name and reported under another.
 */
export type AiTask =
  | 'chat'
  | 'analyze'
  | 'evaluate'
  | 'final_summary'
  | 'mesocycle_feedback'
  | 'mesocycle_generate'
  | 'nutrition_analysis'
  | 'nutrition_targets'

/**
 * Reasoning effort per task.
 *
 * **Reasoning is billed as output tokens**, so this is a cost dial, not just a
 * quality one. A single global 'medium' charged a whole thinking block to
 * answer "¿qué comí ayer?" from context already in the prompt, and gave a
 * mesocycle — the one task where the model is designing something — no more
 * budget than that.
 *
 * The scale used here:
 *  - `low` for turns that read data and report it: the chat answers from a
 *    context it was handed, and most turns are a lookup and a sentence.
 *  - `medium` for the judgement tasks: they weigh several series against each
 *    other and against a target, and the answer is only as good as that
 *    comparison.
 *  - `high` only for plan generation, which has to satisfy hard constraints
 *    (days, weeks, RIR progression, injuries, equipment) simultaneously and is
 *    the one output a deterministic validator then rejects if it doesn't.
 *
 * `null` disables it for models that don't support reasoning.
 */
export const REASONING_BY_TASK: Record<AiTask, ReasoningEffort | null> = {
  chat: 'low',
  analyze: 'medium',
  evaluate: 'medium',
  final_summary: 'medium',
  mesocycle_feedback: 'medium',
  mesocycle_generate: 'high',
  nutrition_analysis: 'medium',
  nutrition_targets: 'medium'
}

/** Max chained tool-call rounds in the chat endpoint before forcing a final answer. */
export const MAX_TOOL_ITERATIONS = 5

/** Chat history window (messages) loaded from DB for each chat turn. */
export const CHAT_HISTORY_WINDOW = 8

/**
 * Output token caps per task type.
 *
 * On models with reasoning, this budget is spent on the reasoning block *before*
 * the answer begins — the effort above allocates a fraction of it — so a cap
 * sized to the visible answer alone truncates the answer, or the reasoning that
 * precedes it. For a JSON task that means an unparseable object or an empty
 * string, neither of which the athlete can act on.
 *
 * The figures below are sized as (expected answer) + (headroom for the effort
 * this task runs at), which is why they dropped when the reasoning did.
 */
export const MAX_OUTPUT_TOKENS = {
  /** A coach's reply is a few hundred tokens; the rest is the 'low' allowance. */
  chat: 8000,
  analysis: 12000,
  finalSummary: 16000,
  /** Small structured payloads (nutrition targets: 5 numbers and a rationale). */
  generation: 8000,
  /**
   * A whole mesocycle as JSON: every week, plus every session with all its
   * exercises. Five training days of six exercises is ~3k tokens of object on
   * its own — the rest of this budget is the 'high' reasoning that precedes it.
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
 *
 * It is also the **only** dial applied to an intermediate round, since a
 * reasoning effort is spent as a fraction of `max_tokens`: capping a plan
 * generation's lookup round here bounds its thinking at a fraction of 16k
 * instead of a fraction of 48k, without lowering the effort of a round that may
 * turn out to be the answer.
 *
 * And it must stay comfortably above the largest answer any round could
 * produce, for the same reason: **"intermediate" is a guess**. The model stops
 * calling tools when it has what it needs, so the round that emits the whole
 * mesocycle is usually round 2 of 6 — one of the rounds this cap applies to. At
 * 8000 that JSON would be truncated mid-object and the generation lost.
 */
export const TOOL_ROUND_MAX_OUTPUT_TOKENS = 16000

/**
 * Ask the provider to cache the stable prefix of a chat request.
 *
 * Only meaningful where the prefix really is stable and really is re-sent, and
 * in this app that is the chat: every tool round replays the entire system
 * prompt plus ~2k tokens of tool definitions, and a five-round turn therefore
 * pays for that prefix six times. `buildLeanSystemPrompt` is ordered so the
 * invariant part (persona, rules, grounding) comes first and the athlete's data
 * after it — see ai-context.ts.
 *
 * Anthropic through OpenRouter needs an explicit breakpoint, which the adapter
 * adds to the system message; OpenAI-family models cache long prefixes
 * automatically and ignore the marker. Stateless tasks are not cached: they run
 * once with a payload that is different every time, so a cache write (billed
 * above the normal input rate) would never be read.
 */
export const AI_PROMPT_CACHE = true
