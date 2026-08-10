import type { H3Event } from 'h3'
import type { AiModelPrice } from '@prisma/client'
import { prisma } from './prisma'
import { CHAT_CONTEXT_TYPE } from './conversations'

/**
 * Shared plumbing for the admin AI analytics: date-range parsing, model pricing
 * and cost arithmetic.
 *
 * Cost lives here and nowhere else. Three endpoints report money (`ai-stats`,
 * `ai-usage`, `users`) and a divergent formula between them would show the admin
 * three different totals for the same period — the same reason `runChatTurn`
 * owns the turn logic for both chat endpoints.
 */

/** Human labels for `AiConversation.context_type`, for the admin tables. */
export const TASK_LABELS: Record<string, string> = {
  [CHAT_CONTEXT_TYPE]: 'Chat',
  analyze: 'Análisis de entreno',
  evaluate: 'Evaluación semanal',
  final_summary: 'Resumen de mesociclo',
  mesocycle_feedback: 'Feedback de plan',
  mesocycle_generate: 'Generación de mesociclo',
  nutrition_analysis: 'Análisis de dieta',
  nutrition_targets: 'Objetivos nutricionales'
}

export function taskLabel(contextType: string): string {
  return TASK_LABELS[contextType] ?? contextType
}

/** Prices are quoted per million tokens — the unit every vendor publishes. */
const TOKENS_PER_PRICE_UNIT = 1_000_000

// ── Date range ────────────────────────────────────────────────────────────────

export interface DateRange {
  from: Date | null
  to: Date | null
}

/**
 * Reads `?from`/`?to` (ISO dates or datetimes) off the request. Absent or
 * unparseable bounds mean "unbounded on that side", so a bad query degrades to
 * a wider result set instead of an error page in the admin panel.
 *
 * A bare `to=YYYY-MM-DD` is pushed to the end of that day: the admin picking a
 * day as the upper bound expects that day included, not excluded at 00:00.
 */
export function parseRange(event: H3Event): DateRange {
  const query = getQuery(event)
  return {
    from: parseBound(query.from, false),
    to: parseBound(query.to, true)
  }
}

function parseBound(raw: unknown, isUpper: boolean): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return null
  if (isUpper && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    date.setHours(23, 59, 59, 999)
  }
  return date
}

/** Spreads into a Prisma `where`; yields `{}` when the range is unbounded. */
export function rangeFilter(range: DateRange) {
  if (!range.from && !range.to) return {}
  return {
    created_at: {
      ...(range.from && { gte: range.from }),
      ...(range.to && { lte: range.to })
    }
  }
}

// ── Pricing ───────────────────────────────────────────────────────────────────

export type PriceMap = Map<string, AiModelPrice>

/** All configured prices, indexed by model slug. One query per request. */
export async function loadPrices(): Promise<PriceMap> {
  const prices = await prisma.aiModelPrice.findMany()
  return new Map(prices.map(p => [p.model, p]))
}

/** Token counts of a single interaction. Nulls mean "not recorded". */
export interface UsageTokens {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number
}

/**
 * Cost in the price's currency, or null when it can't be computed exactly:
 * the model has no configured price, or the row predates the in/out breakdown.
 *
 * Deliberately no estimation. Splitting a legacy total by an assumed ratio would
 * produce a number that looks authoritative and isn't; a hole the UI can render
 * as "—" is the honest answer.
 */
export function rowCost(
  row: { model: string | null } & UsageTokens,
  prices: PriceMap
): number | null {
  if (!row.model) return null
  const price = prices.get(row.model)
  if (!price) return null
  if (row.inputTokens === null || row.outputTokens === null) return null

  return (
    (row.inputTokens / TOKENS_PER_PRICE_UNIT) * price.input_per_1m +
    (row.outputTokens / TOKENS_PER_PRICE_UNIT) * price.output_per_1m
  )
}

/** Currency of a model's price, for formatting. Defaults to USD. */
export function currencyOf(model: string | null, prices: PriceMap): string {
  return (model && prices.get(model)?.currency) || 'USD'
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/** One assistant message, flattened with the owning conversation's context. */
export interface UsageRow {
  id: string
  userId: string
  userName: string
  conversationId: string
  conversationTitle: string | null
  model: string | null
  contextType: string
  createdAt: Date
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number
  /** null when the model is unpriced or the breakdown is missing. */
  cost: number | null
}

/**
 * Running totals over a set of rows.
 *
 * `cost` sums only the rows that could be priced; `unpricedCount` and
 * `noBreakdownCount` say how many were left out, so the UI can flag a total as
 * partial rather than presenting an understated figure as complete.
 */
export interface UsageTotals {
  interactions: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  /** Rows skipped in `cost` because their model has no price configured. */
  unpricedCount: number
  /** Rows skipped in `cost` because they predate the in/out breakdown. */
  noBreakdownCount: number
  lastUsedAt: Date | null
}

export function emptyTotals(): UsageTotals {
  return {
    interactions: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cost: 0,
    unpricedCount: 0,
    noBreakdownCount: 0,
    lastUsedAt: null
  }
}

export function accumulate(totals: UsageTotals, row: UsageRow, prices: PriceMap): UsageTotals {
  totals.interactions++
  totals.inputTokens += row.inputTokens ?? 0
  totals.outputTokens += row.outputTokens ?? 0
  totals.totalTokens += row.totalTokens

  if (row.cost !== null) {
    totals.cost += row.cost
  } else if (row.inputTokens === null || row.outputTokens === null) {
    totals.noBreakdownCount++
  } else if (!row.model || !prices.has(row.model)) {
    totals.unpricedCount++
  }

  if (!totals.lastUsedAt || row.createdAt > totals.lastUsedAt) {
    totals.lastUsedAt = row.createdAt
  }
  return totals
}

/**
 * Groups rows by a derived key, accumulating totals per group.
 *
 * Grouping happens in JS rather than SQL because every dimension the panel needs
 * (user, task type) lives on the parent AiConversation, and Prisma's `groupBy`
 * can't group across a relation — the alternative is raw SQL per view.
 */
export function groupTotals<K extends string>(
  rows: UsageRow[],
  prices: PriceMap,
  keyOf: (row: UsageRow) => K
): Map<K, UsageTotals> {
  const groups = new Map<K, UsageTotals>()
  for (const row of rows) {
    const key = keyOf(row)
    let totals = groups.get(key)
    if (!totals) {
      totals = emptyTotals()
      groups.set(key, totals)
    }
    accumulate(totals, row, prices)
  }
  return groups
}

/** Prisma `select` for the conversation fields every usage query needs. */
export const USAGE_CONVERSATION_SELECT = {
  id: true,
  title: true,
  user_id: true,
  context_type: true,
  user: { select: { name: true, email: true } }
} as const

/** Prisma `where` matching the assistant messages that represent billed calls. */
export const BILLED_MESSAGE_WHERE = {
  role: 'assistant',
  model_used: { not: null }
} as const

/** Flattens a queried AiMessage (with conversation included) into a UsageRow. */
export function toUsageRow(
  message: {
    id: string
    model_used: string | null
    tokens_used: number | null
    input_tokens: number | null
    output_tokens: number | null
    created_at: Date
    conversation: {
      id: string
      title: string | null
      user_id: string
      context_type: string
      user: { name: string; email: string } | null
    }
  },
  prices: PriceMap
): UsageRow {
  const base = {
    id: message.id,
    userId: message.conversation.user_id,
    userName: message.conversation.user?.name ?? 'Desconocido',
    conversationId: message.conversation.id,
    conversationTitle: message.conversation.title,
    model: message.model_used,
    contextType: message.conversation.context_type,
    createdAt: message.created_at,
    inputTokens: message.input_tokens,
    outputTokens: message.output_tokens,
    totalTokens: message.tokens_used ?? 0
  }
  return { ...base, cost: rowCost(base, prices) }
}

// ── Time bucketing ────────────────────────────────────────────────────────────

/**
 * Bucketing keys are local and Monday-first — "which day did this cost land on"
 * is a question about the admin's calendar. They now live in `dates.ts` with the
 * rest of the calendar arithmetic; re-exported here so the admin endpoints keep
 * importing them from the module that owns cost reporting.
 */
import { localDayKey } from './dates'
export { localDayKey, localWeekKey } from './dates'

/** Beyond this many days a daily series is unreadable, so buckets become weeks. */
export const DAILY_BUCKET_LIMIT = 92

/**
 * Every bucket key from `from` to `to` inclusive, including empty ones.
 *
 * Gaps must be rendered as zero, not skipped: a chart that omits quiet days
 * compresses them away and overstates how steady the spend was.
 */
export function bucketKeys(from: Date, to: Date, granularity: 'day' | 'week'): string[] {
  const keys: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate())

  if (granularity === 'week') {
    cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7))
  }

  while (cursor <= last) {
    keys.push(localDayKey(cursor))
    cursor.setDate(cursor.getDate() + (granularity === 'week' ? 7 : 1))
  }
  return keys
}
