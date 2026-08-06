<template>
  <div class="h-[calc(100vh-140px)] flex flex-col">
    <!-- Header with active context -->
    <div class="bg-violet-950/40 border border-violet-900 rounded-t-xl p-4 flex flex-col md:flex-row items-center justify-between">
      <div class="flex items-center gap-3">
        <button
          @click="sidebarOpen = !sidebarOpen"
          class="text-violet-400 hover:text-violet-200 transition p-1 rounded"
          :title="sidebarOpen ? 'Ocultar conversaciones' : 'Mostrar conversaciones'"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div>
          <h1 class="text-xl font-bold text-violet-200 flex items-center">
            <span class="mr-2">🧠</span> AI Coach
          </h1>
          <p class="text-sm text-violet-400 mt-1 truncate max-w-xs">
            {{ activeTitle || 'Tu entrenador personal con contexto de Hevy' }}
          </p>
        </div>
      </div>
      <div class="mt-3 md:mt-0 flex items-center gap-2">
        <span v-if="historyLoading" class="text-xs text-violet-500">Cargando historial...</span>
        <button
          @click="startNewConversation"
          class="text-xs bg-slate-800 text-slate-300 px-3 py-1.5 rounded border border-slate-700 hover:bg-slate-700 transition font-medium"
        >
          Nueva conversación
        </button>
      </div>
    </div>

    <!-- Body: sidebar + chat -->
    <div class="flex-grow flex overflow-hidden border-x border-slate-800 bg-slate-950/50">
      <!-- Conversation sidebar -->
      <aside
        v-if="sidebarOpen"
        class="w-64 flex-shrink-0 border-r border-slate-800 hidden md:block"
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
            <div class="animate-spin w-6 h-6 rounded-full border-4 border-violet-500 border-t-transparent"></div>
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

            <!-- Empty state -->
            <div v-if="chatHistory.length === 0" class="text-center py-12 text-slate-500">
              <p class="text-4xl mb-3">🏋️</p>
              <p class="font-medium text-slate-400">¡Empieza la conversación!</p>
              <p class="text-sm mt-1">Pregúntame sobre tus entrenamientos o el mesociclo actual.</p>
            </div>
          </template>

          <!-- Thinking / tool indicator: only while waiting for the first token -->
          <div v-if="isTyping && !isStreamingReply" class="flex justify-start mb-6">
            <div class="flex-shrink-0 mr-3 mt-1">
              <div class="w-8 h-8 bg-violet-950 rounded-full flex items-center justify-center text-violet-400 text-sm ring-1 ring-violet-800">
                🤖
              </div>
            </div>
            <div class="bg-slate-800 border border-slate-700 text-slate-300 rounded-2xl rounded-tl-sm px-5 py-3 flex items-center gap-2">
              <span class="flex items-center space-x-1.5">
                <span class="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style="animation-delay: 0s"></span>
                <span class="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style="animation-delay: 0.15s"></span>
                <span class="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style="animation-delay: 0.3s"></span>
              </span>
              <span v-if="activityLabel" class="text-xs text-violet-300">{{ activityLabel }}</span>
            </div>
          </div>
        </div>

        <!-- Quick Actions -->
        <div class="absolute bottom-4 left-0 w-full px-6 flex justify-center space-x-2 transition-opacity duration-300" :class="isTyping || chatHistory.length > 0 ? 'opacity-0 pointer-events-none' : 'opacity-100'">
          <button @click="sendQuickPrompt('¿Cómo voy esta semana?')" class="bg-slate-800 border border-slate-700 text-slate-400 text-xs px-3 py-1.5 rounded-full hover:bg-violet-950/40 hover:text-violet-400 hover:border-violet-800 transition">
            ¿Cómo voy esta semana?
          </button>
          <button @click="sendQuickPrompt('Analiza mi último entreno de pecho')" class="bg-slate-800 border border-slate-700 text-slate-400 text-xs px-3 py-1.5 rounded-full hover:bg-violet-950/40 hover:text-violet-400 hover:border-violet-800 transition hidden sm:block">
            Analiza mi último entreno
          </button>
          <button @click="sendQuickPrompt('¿Debería hacer deload?')" class="bg-slate-800 border border-slate-700 text-slate-400 text-xs px-3 py-1.5 rounded-full hover:bg-violet-950/40 hover:text-violet-400 hover:border-violet-800 transition hidden md:block">
            ¿Debería hacer deload?
          </button>
        </div>
      </div>
    </div>

    <!-- Input Area -->
    <div class="bg-slate-900 border border-slate-800 rounded-b-xl p-4 relative z-10">
      <form @submit.prevent="sendMessage" class="flex items-end bg-slate-800 border border-slate-700 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-violet-500 focus-within:border-violet-500 transition-shadow p-1">
        <textarea
          ref="messageInput"
          v-model="inputQuery"
          rows="1"
          placeholder="Pregunta sobre tus entrenos, sugiere cambios..."
          class="flex-grow bg-transparent border-none focus:ring-0 resize-none px-4 py-3 min-h-[44px] max-h-32 text-[15px] text-slate-100 placeholder-slate-600 outline-none"
          @keydown.enter.prevent="handleEnter"
          @input="adjustTextareaHeight"
        ></textarea>

        <div class="px-2 py-2 flex items-center h-full">
          <button
            type="submit"
            :disabled="!inputQuery.trim() || isTyping"
            class="bg-violet-600 text-white p-2.5 rounded-lg hover:bg-violet-500 transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <svg class="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
          </button>
        </div>
      </form>
      <div class="text-center mt-2">
        <p class="text-[10px] text-slate-600">HevyTracker AI puede cometer errores. Considera revisar los consejos con un profesional.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { ConversationSummary } from '~/components/chat/ConversationList.vue'

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

  if (route.query.context === 'workout') {
    // Workout hand-off always starts a fresh thread instead of appending to
    // whatever was open.
    startNewConversation()
    sendQuickPrompt('Analiza el rendimiento de mi último entrenamiento y sugiere ajustes para la próxima sesión.', false)
  }
})

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
    alert('No se pudo borrar la conversación.')
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
    } else if (payload.type === 'tool') {
      activeTool.value = payload.name
      // A tool call after partial text means the model is still working: keep
      // the text but bring the activity indicator back.
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

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(100, 116, 139, 0.3);
  border-radius: 10px;
}
</style>
