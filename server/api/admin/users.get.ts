import { prisma } from '../../utils/prisma'
import { requireAdmin } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const users = await prisma.user.findMany({
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
  })

  // Per-user token consumption
  const tokenRows = await prisma.aiMessage.groupBy({
    by: ['conversation_id'],
    _sum: { tokens_used: true }
  })

  // Map conversation_id → user_id
  const conversations = await prisma.aiConversation.findMany({
    where: { id: { in: tokenRows.map(r => r.conversation_id) } },
    select: { id: true, user_id: true }
  })

  const tokensByUser = new Map<string, number>()
  for (const row of tokenRows) {
    const convo = conversations.find(c => c.id === row.conversation_id)
    if (!convo?.user_id) continue
    tokensByUser.set(convo.user_id, (tokensByUser.get(convo.user_id) ?? 0) + (row._sum.tokens_used ?? 0))
  }

  return users.map(u => ({
    ...u,
    tokens_used: tokensByUser.get(u.id) ?? 0
  }))
})
