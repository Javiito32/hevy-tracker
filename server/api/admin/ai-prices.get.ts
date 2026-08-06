import { prisma } from '../../utils/prisma'
import { requireAdmin } from '../../utils/session'
import { BILLED_MESSAGE_WHERE } from '../../utils/ai-usage'

/**
 * Configured model prices, plus the models that have been used but have no
 * price — those are the ones missing from every cost figure in the panel, so
 * the UI can prompt the admin to fill them in.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const [prices, usedModels] = await Promise.all([
    prisma.aiModelPrice.findMany({ orderBy: { model: 'asc' } }),
    prisma.aiMessage.groupBy({
      by: ['model_used'],
      where: BILLED_MESSAGE_WHERE,
      _count: { id: true }
    })
  ])

  const priced = new Set(prices.map(p => p.model))

  return {
    prices,
    unpriced_models: usedModels
      .filter(m => m.model_used && !priced.has(m.model_used))
      .map(m => ({ model: m.model_used!, interactions: m._count.id }))
      .sort((a, b) => b.interactions - a.interactions)
  }
})
