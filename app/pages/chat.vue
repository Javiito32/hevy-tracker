<template>
  <div class="h-[calc(100vh-140px)] flex flex-col">
    <!-- Header with active context -->
    <div class="bg-violet-950/40 border border-violet-900 rounded-t-xl p-4 flex flex-col md:flex-row items-center justify-between">
      <div>
        <h1 class="text-xl font-bold text-violet-200 flex items-center">
          <span class="mr-2">🧠</span> AI Coach
        </h1>
        <p class="text-sm text-violet-400 mt-1">Tu entrenador personal con contexto de Hevy</p>
      </div>
      <div class="mt-3 md:mt-0 flex items-center gap-2">
        <span v-if="historyLoading" class="text-xs text-violet-500">Cargando historial...</span>
        <button
          @click="clearHistory"
          class="text-xs bg-slate-800 text-slate-300 px-3 py-1.5 rounded border border-slate-700 hover:bg-slate-700 transition font-medium"
        >
          Nueva conversación
        </button>
      </div>
    </div>

    <!-- Main Chat Window -->
    <div class="flex-grow bg-slate-950/50 border-x border-slate-800 overflow-hidden flex flex-col relative">
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
          />

          <!-- Empty state -->
          <div v-if="chatHistory.length === 0" class="text-center py-12 text-slate-500">
            <p class="text-4xl mb-3">🏋️</p>
            <p class="font-medium text-slate-400">¡Empieza la conversación!</p>
            <p class="text-sm mt-1">Pregúntame sobre tus entrenamientos o el mesociclo actual.</p>
          </div>
        </template>

        <!-- Typing Indicator -->
        <div v-if="isTyping" class="flex justify-start mb-6">
          <div class="flex-shrink-0 mr-3 mt-1">
            <div class="w-8 h-8 bg-violet-950 rounded-full flex items-center justify-center text-violet-400 text-sm ring-1 ring-violet-800">
              🤖
            </div>
          </div>
          <div class="bg-slate-800 border border-slate-700 text-slate-300 rounded-2xl rounded-tl-sm px-5 py-3 flex items-center space-x-1.5 w-16">
            <span class="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style="animation-delay: 0s"></span>
            <span class="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style="animation-delay: 0.15s"></span>
            <span class="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style="animation-delay: 0.3s"></span>
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
import { ref, nextTick, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const messageInput = ref<HTMLTextAreaElement | null>(null)
const chatContainer = ref<HTMLDivElement | null>(null)

const inputQuery = ref('')
const isTyping = ref(false)
const historyLoading = ref(true)
const conversationId = ref<string | null>(null)

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const chatHistory = ref<Message[]>([])

onMounted(async () => {
  await loadHistory()
  if (route.query.context === 'workout') {
    setTimeout(() => {
      sendQuickPrompt('Analiza el rendimiento de mi último entrenamiento y sugiere ajustes para la próxima sesión.', false)
    }, 500)
  }
})

const loadHistory = async () => {
  historyLoading.value = true
  try {
    const convo = await $fetch<{ id: string; messages: Array<{ role: string; content: string; created_at: string }> }>('/api/conversations')
    conversationId.value = convo.id
    chatHistory.value = convo.messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: new Date(m.created_at)
    }))
    scrollToBottom()
  } catch {
    chatHistory.value = []
  } finally {
    historyLoading.value = false
  }
}

const clearHistory = async () => {
  if (!conversationId.value) return
  try {
    const convo = await $fetch<{ id: string; messages: any[] }>('/api/conversations/new', { method: 'POST' })
    conversationId.value = convo.id
    chatHistory.value = []
  } catch {
    chatHistory.value = []
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
  if (messageInput.value) {
    messageInput.value.style.height = 'auto'
  }

  scrollToBottom()
  isTyping.value = true

  try {
    const historyContext = chatHistory.value.slice(-7, -1).map(m => ({
      role: m.role,
      content: m.content
    }))

    const res = await $fetch<{ success: boolean; message: string; role: string; conversationId?: string }>('/api/chat', {
      method: 'POST',
      body: { message: text, historyContext, conversationId: conversationId.value }
    })

    if (!res) throw new Error('API return empty')

    if (res.conversationId) {
      conversationId.value = res.conversationId
    }

    chatHistory.value.push({
      role: 'assistant',
      content: res.message,
      timestamp: new Date()
    })
  } catch (error: any) {
    console.error(error)
    chatHistory.value.push({
      role: 'assistant',
      content: '⚠️ Ocurrió un error consultando al AI Coach. Por favor, revisa tus API keys en Ajustes.',
      timestamp: new Date()
    })
  } finally {
    isTyping.value = false
    scrollToBottom()
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
