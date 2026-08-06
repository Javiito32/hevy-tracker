import { prisma } from '../../utils/prisma'
import { CHAT_TRANSCRIPT_LIMIT, requireOwnedConversation } from '../../utils/conversations'

/** Returns one conversation with its most recent messages. */
export default defineEventHandler(async (event) => {
  const { conversation } = await requireOwnedConversation(event)

  // Newest-first with a take, then reversed for display. Querying ascending with
  // a take would return the OLDEST 100 messages — the tail is what you want to
  // see when reopening a long conversation.
  const messages = await prisma.aiMessage.findMany({
    where: { conversation_id: conversation.id },
    orderBy: { created_at: 'desc' },
    take: CHAT_TRANSCRIPT_LIMIT,
    select: { id: true, role: true, content: true, model_used: true, created_at: true }
  })

  return {
    id: conversation.id,
    title: conversation.title,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    messages: messages.reverse()
  }
})
