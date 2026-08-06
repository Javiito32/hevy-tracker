import { prisma } from '../../utils/prisma'
import { getSessionUser } from '../../utils/session'
import { CHAT_CONTEXT_TYPE } from '../../utils/conversations'

/** Characters of the last message kept as the sidebar preview. */
const PREVIEW_LENGTH = 80

/**
 * Lists the caller's chat conversations, most recently active first.
 *
 * Ordered by `updated_at`, so reopening /chat resumes the last conversation you
 * actually talked to. This endpoint no longer creates a conversation when none
 * exists — empty rows are what cluttered the list; the row is created on the
 * first message instead (see ai-chat.ts).
 */
export default defineEventHandler(async (event) => {
  const { id: userId } = await getSessionUser(event)

  const conversations = await prisma.aiConversation.findMany({
    where: { user_id: userId, context_type: CHAT_CONTEXT_TYPE },
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      title: true,
      created_at: true,
      updated_at: true,
      _count: { select: { messages: true } },
      messages: {
        orderBy: { created_at: 'desc' },
        take: 1,
        select: { content: true, role: true }
      }
    }
  })

  return conversations
    // Drop empty conversations: the old "Nueva conversación" button persisted a
    // row per click, so existing databases carry a trail of them.
    .filter(c => c._count.messages > 0)
    .map(c => {
      const last = c.messages[0]
      return {
        id: c.id,
        title: c.title,
        created_at: c.created_at,
        updated_at: c.updated_at,
        message_count: c._count.messages,
        preview: last
          ? last.content.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH)
          : ''
      }
    })
})
