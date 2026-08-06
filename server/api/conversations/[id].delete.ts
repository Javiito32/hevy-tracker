import { prisma } from '../../utils/prisma'
import { requireOwnedConversation } from '../../utils/conversations'

/** Deletes a conversation. Its messages go with it via onDelete: Cascade. */
export default defineEventHandler(async (event) => {
  const { conversation } = await requireOwnedConversation(event)

  await prisma.aiConversation.delete({ where: { id: conversation.id } })

  return { success: true, id: conversation.id }
})
