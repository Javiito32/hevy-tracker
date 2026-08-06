import { getSessionUser } from '../utils/session'
import { prisma } from '../utils/prisma'
import { isAiConfigured } from '../utils/ai-provider'
import { aiKeysFromConfig } from '../utils/ai-service'
import { runChatTurn } from '../utils/ai-chat'
import { CHAT_CONTEXT_TYPE } from '../utils/conversations'

/**
 * Buffered chat turn: returns the whole reply at once.
 *
 * `/api/chat/stream` is the path the UI uses; this one remains for callers that
 * can't consume SSE and as the client's fallback. Both share `runChatTurn`.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const body = await readBody<{ message?: string; conversationId?: string | null }>(event)

  const message = body?.message
  if (!message) throw createError({ statusCode: 400, statusMessage: 'Message is required' })

  const aiKeys = aiKeysFromConfig(config)
  if (!isAiConfigured(aiKeys)) {
    const mock = '⚠️ AI API Key no configurada. Por favor, edita tu archivo .env y añade tu clave para obtener análisis reales de IA.'
    // Keep the exchange on the transcript so the UI stays consistent.
    const convoId = body?.conversationId
      ?? (await prisma.aiConversation.create({ data: { user_id: userId, context_type: CHAT_CONTEXT_TYPE }, select: { id: true } })).id
    await prisma.aiMessage.create({ data: { conversation_id: convoId, role: 'user', content: message } })
    await prisma.aiMessage.create({ data: { conversation_id: convoId, role: 'assistant', content: mock } })
    await prisma.aiConversation.update({ where: { id: convoId }, data: { updated_at: new Date() } })
    return { success: false, message: mock, role: 'assistant', conversationId: convoId }
  }

  try {
    const result = await runChatTurn({
      userId,
      conversationId: body?.conversationId ?? null,
      message,
      keys: aiKeys
    })

    return {
      success: true,
      role: 'assistant',
      message: result.reply,
      model: result.model,
      conversationId: result.conversationId,
      title: result.title,
      ...(result.toolsInvoked.length ? { toolsInvoked: result.toolsInvoked } : {})
    }
  } catch (error: any) {
    // Ownership failures from runChatTurn are already H3 errors — don't mask them.
    if (error?.statusCode) throw error
    console.error('AI Error:', error)
    throw createError({ statusCode: 500, statusMessage: 'Error en el servicio de IA' })
  }
})
