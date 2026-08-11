<template>
  <div class="h-[calc(100vh-140px)] flex flex-col">
    <!-- Header with active context -->
    <div class="bg-surface border border-line rounded-t-card px-4 py-3 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2.5 min-w-0">
        <button
          class="w-9 h-9 flex items-center justify-center rounded-lg text-ink-3 hover:text-ink hover:bg-surface-2 transition flex-shrink-0"
          :title="sidebarOpen ? 'Ocultar conversaciones' : 'Mostrar conversaciones'"
          :aria-expanded="sidebarOpen"
          @click="sidebarOpen = !sidebarOpen"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div class="min-w-0">
          <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3">Coach</p>
          <h1 class="font-display text-sm font-semibold tracking-tight text-ink truncate">
            {{ activeTitle || 'Nueva conversación' }}
          </h1>
        </div>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <span v-if="historyLoading" class="text-xs text-ink-3 hidden sm:inline">Cargando historial…</span>
        <UiButton size="sm" variant="secondary" @click="startNewConversation">Nueva</UiButton>
      </div>
    </div>

    <!-- Body: sidebar + chat -->
    <div class="flex-grow flex overflow-hidden border-x border-line bg-bg">
      <!-- Conversation sidebar -->
      <aside
        v-if="sidebarOpen"
        class="w-64 flex-shrink-0 border-r border-line hidden md:block"
      >
        <ChatConversationList
          :conversations="conversations"
          :active-id="conversationId"
          :loading="listLoading"
          @select="selectConversation"
          @new="startNewConversation"
          @delete="deleteConversation"
          @rename="renameConversation"
        />
      </aside>

      <!-- Main Chat Window -->
      <div class="flex-grow overflow-hidden flex flex-col relative min-w-0">
        <!-- Scrollable Message Area -->
        <div
          ref="chatContainer"
          class="flex-grow p-6 overflow-y-auto scroll-smooth custom-scrollbar"
        >
          <div v-if="historyLoading" class="flex justify-center py-8">
            <UiSpinner class="text-ink-3" />
          </div>

          <template v-else>
            <ChatMessageBubble
              v-for="(message, index) in chatHistory"
              :key="index"
              :role="message.role"
              :content="message.content"
              :timestamp="message.timestamp"
              :model-used="message.modelUsed"
              :streaming="message.streaming"
            />

            <!-- An empty screen is an invitation to act, so the openers are the
                 empty state rather than a floating bar that fades out. -->
            <div v-if="chatHistory.length === 0" class="py-10 max-w-md mx-auto text-center">
              <p class="font-display text-sm font-semibold tracking-tight text-ink">Pregúntale a tu coach</p>
              <p class="text-sm text-ink-3 mt-1.5">
                Tiene tus entrenos, tus medidas y el mesociclo activo delante.
              </p>
              <div class="flex flex-col sm:flex-row flex-wrap justify-center gap-2 mt-5">
                <UiButton
                  v-for="prompt in QUICK_PROMPTS"
                  :key="prompt"
                  size="sm"
                  variant="secondary"
                  @click="sendQuickPrompt(prompt)"
                >{{ prompt }}</UiButton>
              </div>
            </div>
          </template>

          <!-- Thinking / tool indicator: only while waiting for the first token -->
          <div v-if="isTyping && !isStreamingReply" class="flex justify-start mb-6">
            <div class="flex-shrink-0 mr-3 mt-1">
              <div class="w-8 h-8 bg-surface-2 border border-line rounded-full flex items-center justify-center font-data text-[10px] font-semibold text-ink-3">
                AI
              </div>
            </div>
            <div class="bg-surface-2 border border-line text-ink-2 rounded-2xl rounded-tl-sm px-5 py-3 flex items-center gap-2.5">
              <span class="flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-ink-3 animate-bounce" style="animation-delay: 0s" />
                <span class="w-1.5 h-1.5 rounded-full bg-ink-3 animate-bounce" style="animation-delay: 0.15s" />
                <span class="w-1.5 h-1.5 rounded-full bg-ink-3 animate-bounce" style="animation-delay: 0.3s" />
              </span>
              <!-- Naming the tool it is running is the honest version of a
                   spinner: the wait has a reason and the reader can see it. -->
              <span v-if="activityLabel" class="text-xs text-ink-3">{{ activityLabel }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Input Area -->
    <div class="bg-surface border border-line rounded-b-card p-3 relative z-10">
      <form
        class="flex items-end bg-surface-2 border border-line rounded-card overflow-hidden
               focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2 focus-within:ring-offset-surface transition p-1"
        @submit.prevent="sendMessage"
      >
        <textarea
          ref="messageInput"
          v-model="inputQuery"
          rows="1"
          placeholder="Pregunta sobre tus entrenos, tu volumen o el mesociclo…"
          class="flex-grow bg-transparent border-none resize-none px-3 py-2.5 min-h-[44px] max-h-32 text-[15px] text-ink placeholder:text-ink-3 outline-none"
          @keydown.enter.prevent="handleEnter"
          @input="adjustTextareaHeight"
        />

        <button
          type="submit"
          :disabled="!inputQuery.trim() || isTyping"
          aria-label="Enviar mensaje"
          class="bg-accent text-accent-ink w-10 h-10 m-1 rounded-lg hover:opacity-85 transition flex items-center justify-center flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
      <p class="text-center text-[10px] text-ink-3 mt-2">
        El coach puede equivocarse. Contrasta lo importante con un profesional.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { ConversationSummary } from '~/components/chat/ConversationList.vue'

const toast = useToast()

/** The openers double as the empty state — an empty screen should suggest a move. */
const QUICK_PROMPTS = [
  '¿Cómo voy esta semana?',
  'Analiza mi último entreno',
  '¿Debería hacer deload?'
] as const

const route = useRoute()
const messageInput = ref<HTMLTextAreaElement | null>(null)
const chatContainer = ref<HTMLDivElement | null>(null)

const inputQuery = ref('')
const isTyping = ref(false)
const isStreamingReply = ref(false)
const historyLoading = ref(true)
const listLoading = ref(true)
const sidebarOpen = ref(true)
const conversationId = ref<string | null>(null)
const conversations = ref<ConversationSummary[]>([])
const activeTool = ref<string | null>(null)

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  modelUsed?: string
  streaming?: boolean
}

const chatHistory = ref<Message[]>([])

const activeTitle = computed(
  () => conversations.value.find(c => c.id === conversationId.value)?.title ?? null
)

/** Human-readable label per tool, shown while the coach gathers data. */
const TOOL_LABELS: Record<string, string> = {
  get_workouts_in_range: 'Revisando tus entrenos…',
  get_workout_detail: 'Mirando el detalle del entreno…',
  list_exercises: 'Buscando entre tus ejercicios…',
  get_exercise_progression: 'Analizando tu progresión…',
  get_body_metrics_range: 'Consultando tus métricas corporales…',
  get_mesocycle_evaluations: 'Leyendo las evaluaciones del mesociclo…',
  get_previous_mesocycles: 'Repasando mesociclos anteriores…',
  get_weekly_aggregates: 'Calculando tu volumen semanal…',
  save_user_note: 'Guardando una nota sobre ti…',
  deactivate_user_note: 'Actualizando tus notas…'
}

const activityLabel = computed(() => {
  if (!activeTool.value) return 'Pensando…'
  return TOOL_LABELS[activeTool.value] ?? 'Consultando tus datos…'
})

onMounted(async () => {
  await loadConversations()
  // Open the most recently active conversation — the list is ordered by updated_at.
  const latest = conversations.value[0]
  if (latest) await selectConversation(latest.id)
  historyLoading.value = false

  // Hand-offs from another page always open a fresh thread rather than
  // appending to whatever happened to be last used.
  const handOff = HAND_OFFS[route.query.context as string]
  if (handOff) {
    startNewConversation()
    sendQuickPrompt(handOff(route.query), false)
  }
})

/**
 * Prompts prefilled when arriving from elsewhere in the app.
 *
 * The message carries the subject explicitly — the chat's system prompt only
 * knows the ACTIVE mesocycle, so a link from a paused or completed block would
 * otherwise land the coach on the wrong one.
 */
const HAND_OFFS: Record<string, (q: Record<string, any>) => string> = {
  workout: () => 'Analiza el rendimiento de mi último entrenamiento y sugiere ajustes para la próxima sesión.',
  mesocycle: (q) => q.name
    ? `Hablemos del mesociclo "${q.name}". Revisa cómo está yendo y qué ajustarías.`
    : 'Revisa cómo está yendo mi mesociclo actual y qué ajustarías.',
  volume: () => 'Revisa mi volumen semanal por grupo muscular frente a los rangos MEV/MAV/MRV y dime qué debería ajustar.',
  alerts: () => 'Repasa los avisos de entrenamiento que tengo activos y dime en qué orden los atacarías.'
}

const loadConversations = async () => {
  listLoading.value = true
  try {
    conversations.value = await $fetch<ConversationSummary[]>('/api/conversations')
  } catch {
    conversations.value = []
  } finally {
    listLoading.value = false
  }
}

const selectConversation = async (id: string) => {
  if (isTyping.value) return
  conversationId.value = id
  historyLoading.value = true
  try {
    const convo = await $fetch<{
      id: string
      messages: Array<{ role: string; content: string; model_used: string | null; created_at: string }>
    }>(`/api/conversations/${id}`)
    chatHistory.value = convo.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: new Date(m.created_at),
      modelUsed: m.model_used ?? undefined
    }))
    scrollToBottom()
  } catch {
    chatHistory.value = []
  } finally {
    historyLoading.value = false
  }
}

/**
 * Starts a new conversation as local state only. The DB row is created with the
 * first message, so abandoned drafts don't litter the sidebar.
 */
const startNewConversation = () => {
  if (isTyping.value) return
  conversationId.value = null
  chatHistory.value = []
  nextTick(() => messageInput.value?.focus())
}

const renameConversation = async (id: string, title: string) => {
  const convo = conversations.value.find(c => c.id === id)
  const previous = convo?.title ?? null
  if (convo) convo.title = title // optimistic
  try {
    await $fetch(`/api/conversations/${id}`, { method: 'PATCH', body: { title } })
  } catch {
    if (convo) convo.title = previous
  }
}

const deleteConversation = async (id: string) => {
  const convo = conversations.value.find(c => c.id === id)
  if (!confirm(`¿Borrar "${convo?.title ?? 'esta conversación'}"? No se puede deshacer.`)) return

  try {
    await $fetch(`/api/conversations/${id}`, { method: 'DELETE' })
    conversations.value = conversations.value.filter(c => c.id !== id)
    if (conversationId.value === id) {
      const next = conversations.value[0]
      if (next) await selectConversation(next.id)
      else startNewConversation()
    }
  } catch {
    toast.error('No se pudo borrar la conversación.')
  }
}

const handleEnter = (e: KeyboardEvent) => {
  if (e.shiftKey) return
  sendMessage()
}

const adjustTextareaHeight = () => {
  if (!messageInput.value) return
  messageInput.value.style.height = 'auto'
  messageInput.value.style.height = Math.min(messageInput.value.scrollHeight, 128) + 'px'
}

const sendQuickPrompt = (prompt: string, sendImmediately = true) => {
  inputQuery.value = prompt
  if (sendImmediately) {
    sendMessage()
  } else {
    nextTick(() => {
      messageInput.value?.focus()
      adjustTextareaHeight()
    })
  }
}

const scrollToBottom = () => {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

const sendMessage = async () => {
  const text = inputQuery.value.trim()
  if (!text || isTyping.value) return

  chatHistory.value.push({ role: 'user', content: text, timestamp: new Date() })

  inputQuery.value = ''
  if (messageInput.value) messageInput.value.style.height = 'auto'

  scrollToBottom()
  isTyping.value = true
  isStreamingReply.value = false
  activeTool.value = null

  const wasNew = conversationId.value === null

  try {
    await streamReply(text)
  } catch (error) {
    console.error(error)
    // Drop a half-streamed bubble before showing the error.
    const last = chatHistory.value[chatHistory.value.length - 1]
    if (last?.streaming && !last.content) chatHistory.value.pop()
    else if (last?.streaming) last.streaming = false

    chatHistory.value.push({
      role: 'assistant',
      content: '⚠️ Ocurrió un error consultando al AI Coach. Por favor, revisa tus API keys en Ajustes.',
      timestamp: new Date()
    })
  } finally {
    isTyping.value = false
    isStreamingReply.value = false
    activeTool.value = null
    scrollToBottom()
    // Refresh so titles, previews and ordering reflect this turn.
    await loadConversations()
    if (wasNew) sidebarOpen.value = true
  }
}

/**
 * Consumes the SSE stream from /api/chat/stream.
 *
 * EventSource can't POST, so the stream is read off fetch()'s body reader and
 * `data:` lines are parsed manually.
 */
const streamReply = async (text: string) => {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, conversationId: conversationId.value })
  })

  if (!response.ok || !response.body) {
    throw new Error(`stream failed: ${response.status}`)
  }

  const bubble: Message = { role: 'assistant', content: '', timestamp: new Date(), streaming: true }
  chatHistory.value.push(bubble)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let streamError: string | null = null

  const handle = (payload: any) => {
    if (payload.type === 'delta') {
      bubble.content += payload.text
      isStreamingReply.value = true
      activeTool.value = null
      scrollToBottom()
    } else if (payload.type === 'reset') {
      // What was streamed turned out to be the model thinking out loud before
      // calling a tool, not the reply. Kept on screen it reads as a first
      // answer that a second one then contradicts — so it goes.
      bubble.content = ''
      isStreamingReply.value = false
    } else if (payload.type === 'tool') {
      activeTool.value = payload.name
      // A tool call means the model is still working: back to the activity
      // indicator (any preamble text was already cleared by 'reset').
      isStreamingReply.value = false
    } else if (payload.type === 'done') {
      bubble.streaming = false
      bubble.modelUsed = payload.model ?? undefined
      if (payload.conversationId) conversationId.value = payload.conversationId
    } else if (payload.type === 'error') {
      streamError = payload.message ?? 'Error en el servicio de IA'
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line; a frame may span several
    // `data:` lines, which are joined with newlines.
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const data = frame
        .split('\n')
        .filter(l => l.startsWith('data:'))
        .map(l => l.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        handle(JSON.parse(data))
      } catch {
        // Ignore malformed frames rather than killing the whole reply.
      }
    }
  }

  bubble.streaming = false

  if (streamError) throw new Error(streamError)
  if (!bubble.content) {
    // Stream closed without producing text — surface it as a failure so the
    // caller replaces the empty bubble with the error message.
    throw new Error('empty reply')
  }
}
</script>
