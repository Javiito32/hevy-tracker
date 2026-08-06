import { prisma } from '../../utils/prisma'
import { requireOwnedConversation } from '../../utils/conversations'

const TITLE_MAX_LENGTH = 120

/** Renames a conversation. */
export default defineEventHandler(async (event) => {
  const { conversation } = await requireOwnedConversation(event)
  const body = await readBody<{ title?: unknown }>(event)

  if (typeof body?.title !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'El título es obligatorio' })
  }

  const title = body.title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH)
  if (!title) throw createError({ statusCode: 400, statusMessage: 'El título no puede estar vacío' })

  // Renaming is not activity: updated_at is left alone so a rename doesn't
  // reshuffle the sidebar.
  const updated = await prisma.aiConversation.update({
    where: { id: conversation.id },
    data: { title },
    select: { id: true, title: true, updated_at: true }
  })

  return updated
})
