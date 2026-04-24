import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)

  let conversation = await prisma.aiConversation.findFirst({
    where: { user_id: userId, context_type: 'general' },
    orderBy: { created_at: 'asc' },
    include: { messages: { orderBy: { created_at: 'asc' }, take: 100 } }
  })

  if (!conversation) {
    conversation = await prisma.aiConversation.create({
      data: { user_id: userId, context_type: 'general' },
      include: { messages: true }
    })
  }

  return conversation
})
