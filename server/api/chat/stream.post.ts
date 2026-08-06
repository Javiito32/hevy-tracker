import { getSessionUser } from '../../utils/session'
import { isAiConfigured } from '../../utils/ai-provider'
import { aiKeysFromConfig } from '../../utils/ai-service'
import { runChatTurn } from '../../utils/ai-chat'

/**
 * Streaming chat turn over Server-Sent Events.
 *
 * A turn can chain up to MAX_TOOL_ITERATIONS rounds of tool calls, so the
 * buffered endpoint leaves the user staring at a spinner for tens of seconds.
 * Here the reply is written as it is generated and each tool call is announced.
 *
 * Event payloads (all JSON on a single `data:` line):
 *   { type: 'tool',  name }
 *   { type: 'delta', text }
 *   { type: 'done',  conversationId, model, title, tokens, toolsInvoked }
 *   { type: 'error', message }
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const { id: userId } = await getSessionUser(event)
  const body = await readBody<{ message?: string; conversationId?: string | null }>(event)

  const message = body?.message
  if (!message) throw createError({ statusCode: 400, statusMessage: 'Message is required' })

  const aiKeys = aiKeysFromConfig(config)
  // Thrown before the stream opens so the client gets a normal HTTP error and
  // can fall back instead of parsing an error event.
  if (!isAiConfigured(aiKeys)) {
    throw createError({ statusCode: 503, statusMessage: 'AI API Key no configurada' })
  }

  const stream = createEventStream(event)
  // Proxies (nginx et al.) buffer responses by default, which would defeat the
  // point by delivering every chunk at once at the end.
  setResponseHeader(event, 'X-Accel-Buffering', 'no')
  setResponseHeader(event, 'Cache-Control', 'no-cache, no-transform')

  const send = (payload: unknown) => stream.push(JSON.stringify(payload))

  // Run the turn detached from the response promise: `send` returns to the event
  // loop, and h3 needs the stream object returned now so headers go out first.
  ;(async () => {
    try {
      const result = await runChatTurn({
        userId,
        conversationId: body?.conversationId ?? null,
        message,
        keys: aiKeys,
        stream: true,
        onEvent: async (e) => {
          if (e.type === 'tool') await send({ type: 'tool', name: e.name })
          else if (e.type === 'delta') await send({ type: 'delta', text: e.text })
        }
      })

      await send({
        type: 'done',
        conversationId: result.conversationId,
        model: result.model,
        title: result.title,
        tokens: result.totalTokens,
        toolsInvoked: result.toolsInvoked
      })
    } catch (error: any) {
      console.error('AI stream error:', error)
      await send({
        type: 'error',
        message: error?.statusMessage ?? 'Error en el servicio de IA'
      }).catch(() => { /* client already gone */ })
    } finally {
      await stream.close()
    }
  })()

  return stream.send()
})
