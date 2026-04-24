import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)

  return prisma.aiConversation.create({
    data: { user_id: userId, context_type: 'general' },
    include: { messages: true }
  })
})
