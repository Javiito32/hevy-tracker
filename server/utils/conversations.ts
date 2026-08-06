import type { H3Event } from 'h3'
import { prisma } from './prisma'
import { getSessionUser } from './session'

/**
 * Chat conversations use context_type 'general'. Every other value is written by
 * `recordAiInteraction()` (ai-service.ts) — one row per analysis/generation, kept
 * only for the admin token stats. Those must never surface in the chat UI.
 */
export const CHAT_CONTEXT_TYPE = 'general'

/** Max messages loaded into the chat UI for one conversation. */
export const CHAT_TRANSCRIPT_LIMIT = 100

/** Characters of the first user message kept as the conversation title. */
const TITLE_MAX_LENGTH = 60

/**
 * Resolves the `id` route param to a conversation the caller owns.
 * Throws 404 for unknown ids and for ids belonging to someone else — not 403,
 * which would confirm the row exists to a caller who shouldn't know.
 */
export async function requireOwnedConversation(event: H3Event) {
  const { id: userId } = await getSessionUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Falta el id de la conversación' })

  const conversation = await prisma.aiConversation.findFirst({
    where: { id, user_id: userId, context_type: CHAT_CONTEXT_TYPE }
  })
  if (!conversation) throw createError({ statusCode: 404, statusMessage: 'Conversación no encontrada' })

  return { conversation, userId }
}

/**
 * Derives a title from the first user message: trimmed to TITLE_MAX_LENGTH on a
 * word boundary. Deterministic and free — an extra model call per conversation
 * just to name it isn't worth the tokens or the latency.
 */
export function deriveConversationTitle(message: string): string {
  const clean = message.replace(/\s+/g, ' ').trim()
  if (!clean) return 'Nueva conversación'
  if (clean.length <= TITLE_MAX_LENGTH) return clean

  const cut = clean.slice(0, TITLE_MAX_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  // Only break on a space if it isn't so early that the title loses meaning.
  return (lastSpace > TITLE_MAX_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…'
}
