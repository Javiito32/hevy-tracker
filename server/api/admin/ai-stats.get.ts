import { prisma } from '../../utils/prisma'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const rows = await prisma.aiMessage.groupBy({
    by: ['model_used'],
    where: { role: 'assistant', model_used: { not: null } },
    _count: { id: true },
    _sum: { tokens_used: true },
    orderBy: { _sum: { tokens_used: 'desc' } }
  })

  return rows.map(r => ({
    model: r.model_used!,
    messages: r._count.id,
    tokens: r._sum.tokens_used ?? 0
  }))
})
