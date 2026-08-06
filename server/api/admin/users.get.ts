import { prisma } from '../../utils/prisma'
import { requireAdmin } from '../../utils/session'
import { BILLED_MESSAGE_WHERE, loadPrices, rowCost } from '../../utils/ai-usage'

/**
 * User list for the admin panel with all-time AI usage per user.
 *
 * The usage figures here are intentionally unfiltered by date — they answer
 * "what has this account consumed in total". The date-scoped view lives in
 * `ai-stats`.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const [users, messages, prices] = await Promise.all([
    prisma.user.findMany({
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
        _count: {
          select: {
            workouts: true,
            mesocycles: true,
            conversations: true
          }
        }
      }
    }),
    // Grouping happens below rather than in `groupBy`: the user id lives on the
    // parent conversation and Prisma can't group across a relation.
    prisma.aiMessage.findMany({
      where: BILLED_MESSAGE_WHERE,
      select: {
        model_used: true,
        tokens_used: true,
        input_tokens: true,
        output_tokens: true,
        created_at: true,
        conversation: { select: { user_id: true } }
      }
    }),
    loadPrices()
  ])

  interface UserUsage {
    tokens: number
    inputTokens: number
    outputTokens: number
    cost: number
    interactions: number
    lastUsedAt: Date | null
  }

  // Keyed Map, not a `find()` per row: the previous version scanned the whole
  // conversation list once per message.
  const usageByUser = new Map<string, UserUsage>()

  for (const message of messages) {
    const userId = message.conversation.user_id
    let usage = usageByUser.get(userId)
    if (!usage) {
      usage = { tokens: 0, inputTokens: 0, outputTokens: 0, cost: 0, interactions: 0, lastUsedAt: null }
      usageByUser.set(userId, usage)
    }

    usage.interactions++
    usage.tokens += message.tokens_used ?? 0
    usage.inputTokens += message.input_tokens ?? 0
    usage.outputTokens += message.output_tokens ?? 0
    usage.cost += rowCost(
      {
        model: message.model_used,
        inputTokens: message.input_tokens,
        outputTokens: message.output_tokens,
        totalTokens: message.tokens_used ?? 0
      },
      prices
    ) ?? 0

    if (!usage.lastUsedAt || message.created_at > usage.lastUsedAt) {
      usage.lastUsedAt = message.created_at
    }
  }

  return users.map(u => {
    const usage = usageByUser.get(u.id)
    return {
      ...u,
      tokens_used: usage?.tokens ?? 0,
      input_tokens: usage?.inputTokens ?? 0,
      output_tokens: usage?.outputTokens ?? 0,
      ai_cost: usage?.cost ?? 0,
      ai_interactions: usage?.interactions ?? 0,
      last_ai_use_at: usage?.lastUsedAt ?? null
    }
  })
})
