import { prisma } from '../../utils/prisma'
import { requireAdmin } from '../../utils/session'
import {
  BILLED_MESSAGE_WHERE,
  DAILY_BUCKET_LIMIT,
  USAGE_CONVERSATION_SELECT,
  accumulate,
  bucketKeys,
  currencyOf,
  emptyTotals,
  groupTotals,
  loadPrices,
  localDayKey,
  localWeekKey,
  parseRange,
  rangeFilter,
  rowCost,
  taskLabel,
  toUsageRow,
  type PriceMap,
  type UsageRow,
  type UsageTotals
} from '../../utils/ai-usage'

/** Models charted individually before the tail folds into "Otros". */
const SERIES_LIMIT = 4

/** Interactions listed in the "most expensive" table. */
const TOP_INTERACTIONS = 10

/**
 * Aggregated AI usage and cost for the admin panel.
 *
 * Query: ?from&to (ISO). Unbounded = all history.
 *
 * Every breakdown is computed from ONE query over the billed messages in range,
 * reduced in JS. Prisma's `groupBy` can't group across the AiConversation
 * relation, where user and task type live, so per-user aggregation would need
 * raw SQL per view; a single scan is both simpler and cheaper at this scale.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const range = parseRange(event)
  const prices = await loadPrices()

  // All-time model list, used only to pin each model to a stable colour slot.
  const allTimeModels = await prisma.aiMessage.groupBy({
    by: ['model_used'],
    where: BILLED_MESSAGE_WHERE
  })

  const messages = await prisma.aiMessage.findMany({
    where: { ...BILLED_MESSAGE_WHERE, ...rangeFilter(range) },
    select: {
      id: true,
      model_used: true,
      tokens_used: true,
      input_tokens: true,
      output_tokens: true,
      cached_input_tokens: true,
      cache_write_tokens: true,
      reasoning_tokens: true,
      latency_ms: true,
      tool_rounds: true,
      tool_calls: true,
      created_at: true,
      conversation: { select: USAGE_CONVERSATION_SELECT }
    }
  })

  const rows: UsageRow[] = messages.map(m => toUsageRow(m, prices))

  const totals = rows.reduce((acc, row) => accumulate(acc, row, prices), emptyTotals())

  const byModel = [...groupTotals(rows, prices, r => r.model ?? 'desconocido')]
    .map(([model, t]) => ({
      model,
      currency: currencyOf(model, prices),
      priced: prices.has(model),
      ...serialize(t)
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)

  // Names come from the rows themselves, so a user with no usage in range is
  // absent here rather than listed with zeros.
  const userNames = new Map(rows.map(r => [r.userId, r.userName]))

  const byUser = [...groupTotals(rows, prices, r => r.userId)]
    .map(([userId, t]) => ({
      user_id: userId,
      user_name: userNames.get(userId) ?? 'Desconocido',
      ...serialize(t)
    }))
    .sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens)

  // Cross tab: feeds the expandable per-user detail without a second request.
  const byUserModel = [...groupTotals(rows, prices, r => compositeKey(r.userId, r.model ?? 'desconocido'))]
    .map(([key, t]) => {
      const [userId, model] = splitKey(key)
      return { user_id: userId, model, ...serialize(t) }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)

  const byUserTask = [...groupTotals(rows, prices, r => compositeKey(r.userId, r.contextType))]
    .map(([key, t]) => {
      const [userId, contextType] = splitKey(key)
      return {
        user_id: userId,
        context_type: contextType,
        task_label: taskLabel(contextType),
        ...serialize(t)
      }
    })
    .sort((a, b) => b.totalTokens - a.totalTokens)

  const byTask = [...groupTotals(rows, prices, r => r.contextType)]
    .map(([contextType, t]) => ({
      context_type: contextType,
      task_label: taskLabel(contextType),
      ...serialize(t)
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)

  // Models seen in use with no price row — surfaced so the admin knows exactly
  // which prices are missing from the cost totals.
  const unpricedModels = [...new Set(rows.map(r => r.model).filter((m): m is string => !!m && !prices.has(m)))]

  // Ten priciest calls in range. Rows that can't be costed are excluded rather
  // than sorted as 0 — they'd claim the cheapest slots without evidence.
  const topInteractions = rows
    .filter(r => r.cost !== null)
    .sort((a, b) => b.cost! - a.cost!)
    .slice(0, TOP_INTERACTIONS)
    .map(r => ({
      id: r.id,
      created_at: r.createdAt,
      user_name: r.userName,
      model: r.model,
      task_label: taskLabel(r.contextType),
      conversation_id: r.conversationId,
      conversation_title: r.conversationTitle,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      total_tokens: r.totalTokens,
      cached_input_tokens: r.cachedInputTokens,
      cache_write_tokens: r.cacheWriteTokens,
      reasoning_tokens: r.reasoningTokens,
      latency_ms: r.latencyMs,
      tool_rounds: r.toolRounds,
      tool_calls: r.toolCalls,
      cost: r.cost,
      currency: currencyOf(r.model, prices)
    }))

  return {
    range: { from: range.from, to: range.to },
    totals: serialize(totals),
    by_model: byModel,
    by_user: byUser,
    by_user_model: byUserModel,
    by_user_task: byUserTask,
    by_task: byTask,
    unpriced_models: unpricedModels,
    timeline: buildTimeline(rows, range, allTimeModels),
    month_to_date: await buildMonthToDate(prices),
    top_interactions: topInteractions
  }
})

/**
 * Per-bucket totals split by model, for the trend chart.
 *
 * Series colours are pinned to each model's position in the **all-time**
 * alphabetical list, not to its rank in the current range: ranking by cost would
 * repaint every series whenever the date filter changes, so a reader who learned
 * "sonnet is blue" would be misled by the next range they pick.
 */
function buildTimeline(
  rows: UsageRow[],
  range: { from: Date | null; to: Date | null },
  allTimeModels: { model_used: string | null }[]
) {
  const colorIndex = new Map(
    allTimeModels
      .map(m => m.model_used)
      .filter((m): m is string => !!m)
      .sort()
      .map((model, i) => [model, i])
  )

  // Unbounded ranges span the data itself, so "todo el histórico" still charts.
  const timestamps = rows.map(r => r.createdAt.getTime())
  const from = range.from ?? (timestamps.length ? new Date(Math.min(...timestamps)) : null)
  const to = range.to ?? (timestamps.length ? new Date(Math.max(...timestamps)) : null)
  if (!from || !to) {
    return { granularity: 'day' as const, series: [], buckets: [] }
  }

  const spanDays = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1
  const granularity: 'day' | 'week' = spanDays > DAILY_BUCKET_LIMIT ? 'week' : 'day'
  const keyOf = granularity === 'week' ? localWeekKey : localDayKey

  // Which models get their own band: the biggest in range, tail folded into one
  // "Otros" series rather than inventing more hues for it.
  const modelTotals = new Map<string, number>()
  for (const row of rows) {
    const model = row.model ?? 'desconocido'
    modelTotals.set(model, (modelTotals.get(model) ?? 0) + (row.cost ?? row.totalTokens / 1e6))
  }
  const ranked = [...modelTotals.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m)
  const charted = ranked.slice(0, SERIES_LIMIT)
  const hasOther = ranked.length > SERIES_LIMIT
  const seriesKey = (model: string) => (charted.includes(model) ? model : 'Otros')

  const empty = () => ({ cost: 0, tokens: 0, input: 0, output: 0, interactions: 0 })
  const buckets = new Map<string, Map<string, ReturnType<typeof empty>>>()
  for (const key of bucketKeys(from, to, granularity)) buckets.set(key, new Map())

  for (const row of rows) {
    const bucket = buckets.get(keyOf(row.createdAt))
    // Rows outside the generated span (only possible on an unbounded range with
    // a single timestamp) are dropped rather than silently rebucketed.
    if (!bucket) continue
    const key = seriesKey(row.model ?? 'desconocido')
    const cell = bucket.get(key) ?? empty()
    cell.cost += row.cost ?? 0
    cell.tokens += row.totalTokens
    cell.input += row.inputTokens ?? 0
    cell.output += row.outputTokens ?? 0
    cell.interactions++
    bucket.set(key, cell)
  }

  return {
    granularity,
    series: [
      ...charted.map(model => ({ key: model, label: model, color_index: colorIndex.get(model) ?? 0 })),
      ...(hasOther ? [{ key: 'Otros', label: 'Otros', color_index: -1 }] : [])
    ],
    buckets: [...buckets.entries()].map(([date, cells]) => ({
      date,
      values: Object.fromEntries(cells),
      cost: [...cells.values()].reduce((s, c) => s + c.cost, 0),
      tokens: [...cells.values()].reduce((s, c) => s + c.tokens, 0),
      interactions: [...cells.values()].reduce((s, c) => s + c.interactions, 0)
    }))
  }
}

/**
 * Current-calendar-month spend and a naive end-of-month projection.
 *
 * Deliberately independent of the selected range — "what will this month cost"
 * is a fixed question, and scoping it to an arbitrary filter would make the
 * projection meaningless.
 */
async function buildMonthToDate(prices: PriceMap) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const daysElapsed = now.getDate()

  const messages = await prisma.aiMessage.findMany({
    where: { ...BILLED_MESSAGE_WHERE, created_at: { gte: monthStart } },
    select: { model_used: true, tokens_used: true, input_tokens: true, output_tokens: true, cached_input_tokens: true, cache_write_tokens: true }
  })

  let cost = 0
  let tokens = 0
  for (const m of messages) {
    tokens += m.tokens_used ?? 0
    cost += rowCost(
      {
        model: m.model_used,
        inputTokens: m.input_tokens,
        outputTokens: m.output_tokens,
        totalTokens: m.tokens_used ?? 0,
        cachedInputTokens: m.cached_input_tokens,
        cacheWriteTokens: m.cache_write_tokens
      },
      prices
    ) ?? 0
  }

  return {
    cost,
    tokens,
    interactions: messages.length,
    days_elapsed: daysElapsed,
    days_in_month: daysInMonth,
    projected_cost: (cost / daysElapsed) * daysInMonth
  }
}

/**
 * Two-part grouping key. The separator is a character that cannot occur in a
 * uuid, a model slug or a context_type, so splitting back is unambiguous —
 * a space would break on any future value that contains one.
 */
const KEY_SEPARATOR = '\u001f'

function compositeKey(a: string, b: string): string {
  return `${a}${KEY_SEPARATOR}${b}`
}

function splitKey(key: string): [string, string] {
  const [a = '', b = ''] = key.split(KEY_SEPARATOR)
  return [a, b]
}

/** UsageTotals → JSON-friendly shape with snake_case counters. */
function serialize(t: UsageTotals) {
  return {
    interactions: t.interactions,
    inputTokens: t.inputTokens,
    outputTokens: t.outputTokens,
    totalTokens: t.totalTokens,
    cachedInputTokens: t.cachedInputTokens,
    cacheWriteTokens: t.cacheWriteTokens,
    reasoningTokens: t.reasoningTokens,
    cost: t.cost,
    unpriced_count: t.unpricedCount,
    no_breakdown_count: t.noBreakdownCount,
    last_used_at: t.lastUsedAt
  }
}
