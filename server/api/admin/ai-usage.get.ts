import { prisma } from '../../utils/prisma'
import { requireAdmin } from '../../utils/session'
import {
  BILLED_MESSAGE_WHERE,
  USAGE_CONVERSATION_SELECT,
  currencyOf,
  loadPrices,
  parseRange,
  rangeFilter,
  taskLabel,
  toUsageRow
} from '../../utils/ai-usage'

/**
 * Paginated log of individual AI interactions for the admin panel: when, who,
 * which model, which task, tokens in/out and cost.
 *
 * Query: ?from&to&userId&model&page&pageSize.
 *
 * Paginates in SQL rather than reusing the full scan in `ai-stats`: this view
 * only ever shows one page, and the table grows without bound.
 */
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const query = getQuery(event)
  const range = parseRange(event)
  const prices = await loadPrices()

  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.pageSize) || DEFAULT_PAGE_SIZE))

  const userId = typeof query.userId === 'string' && query.userId ? query.userId : undefined
  const model = typeof query.model === 'string' && query.model ? query.model : undefined
  const contextType = typeof query.contextType === 'string' && query.contextType ? query.contextType : undefined

  const where = {
    ...BILLED_MESSAGE_WHERE,
    ...rangeFilter(range),
    ...(model && { model_used: model }),
    ...((userId || contextType) && {
      conversation: {
        ...(userId && { user_id: userId }),
        ...(contextType && { context_type: contextType })
      }
    })
  }

  const [total, messages] = await Promise.all([
    prisma.aiMessage.count({ where }),
    prisma.aiMessage.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        model_used: true,
        tokens_used: true,
        input_tokens: true,
        output_tokens: true,
        created_at: true,
        conversation: { select: { id: true, title: true, ...USAGE_CONVERSATION_SELECT } }
      }
    })
  ])

  const items = messages.map(m => {
    const row = toUsageRow(m, prices)
    return {
      id: row.id,
      created_at: row.createdAt,
      user_id: row.userId,
      user_name: row.userName,
      user_email: m.conversation.user?.email ?? null,
      model: row.model,
      context_type: row.contextType,
      task_label: taskLabel(row.contextType),
      conversation_id: m.conversation.id,
      conversation_title: m.conversation.title,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      total_tokens: row.totalTokens,
      cost: row.cost,
      currency: currencyOf(row.model, prices)
    }
  })

  return {
    items,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize))
  }
})
