<template>
  <div class="h-[calc(100vh-140px)] flex flex-col">
    <!-- Header with active context -->
    <div class="bg-indigo-50 border border-indigo-100 rounded-t-xl p-4 flex flex-col md:flex-row items-center justify-between shadow-sm">
      <div>
        <h1 class="text-xl font-bold text-indigo-900 flex items-center">
          <span class="mr-2">🧠</span> AI Coach
        </h1>
        <p class="text-sm text-indigo-700 mt-1">Tu entrenador personal con contexto de Hevy</p>
      </div>
      <div class="mt-3 md:mt-0 flex items-center gap-2">
        <span v-if="historyLoading" class="text-xs text-indigo-400">Cargando historial...</span>
        <button
          @click="clearHistory"
          class="text-xs bg-white text-indigo-700 px-3 py-1.5 rounded border border-indigo-200 hover:bg-indigo-100 transition shadow-sm font-medium"
        >
          Nueva conversación
        </button>
      </div>
    </div>

    <!-- Main Chat Window -->
    <div class="flex-grow bg-gray-50 border-x border-gray-200 overflow-hidden flex flex-col relative shadow-inner">
      <!-- Scrollable Message Area -->
      <div
        ref="chatContainer"
        class="flex-grow p-6 overflow-y-auto scroll-smooth custom-scrollbar"
      >
        <div v-if="historyLoading" class="flex justify-center py-8">
          <div class="animate-spin w-6 h-6 rounded-full border-4 border-purple-500 border-t-transparent"></div>
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
          <div v-if="chatHistory.length === 0" class="text-center py-12 text-gray-400">
            <p class="text-4xl mb-3">🏋️</p>
            <p class="font-medium text-gray-500">¡Empieza la conversación!</p>
            <p class="text-sm mt-1">Pregúntame sobre tus entrenamientos o el mesociclo actual.</p>
          </div>
        </template>

        <!-- Typing Indicator -->
        <div v-if="isTyping" class="flex justify-start mb-6">
          <div class="flex-shrink-0 mr-3 mt-1">
            <div class="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 text-sm shadow-sm ring-1 ring-purple-200">
              🤖
            </div>
          </div>
          <div class="bg-white border border-gray-200 text-gray-800 rounded-2xl rounded-tl-sm px-5 py-3 shadow-sm flex items-center space-x-1.5 w-16">
            <span class="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style="animation-delay: 0s"></span>
            <span class="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style="animation-delay: 0.15s"></span>
            <span class="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style="animation-delay: 0.3s"></span>
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="absolute bottom-4 left-0 w-full px-6 flex justify-center space-x-2 transition-opacity duration-300" :class="isTyping || chatHistory.length > 0 ? 'opacity-0 pointer-events-none' : 'opacity-100'">
        <button @click="sendQuickPrompt('¿Cómo voy esta semana?')" class="bg-white border border-gray-300 text-gray-600 text-xs px-3 py-1.5 rounded-full hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200 transition shadow-sm">
          ¿Cómo voy esta semana?
        </button>
        <button @click="sendQuickPrompt('Analiza mi último entreno de pecho')" class="bg-white border border-gray-300 text-gray-600 text-xs px-3 py-1.5 rounded-full hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200 transition shadow-sm hidden sm:block">
          Analiza mi último entreno
        </button>
        <button @click="sendQuickPrompt('¿Debería hacer deload?')" class="bg-white border border-gray-300 text-gray-600 text-xs px-3 py-1.5 rounded-full hover:bg-purple-50 hover:text-purple-700 hover:border-purple-200 transition shadow-sm hidden md:block">
          ¿Debería hacer deload?
        </button>
      </div>
    </div>

    <!-- Input Area -->
    <div class="bg-white border text-gray-800 border-gray-200 rounded-b-xl p-4 shadow-sm relative z-10">
      <form @submit.prevent="sendMessage" class="flex items-end bg-gray-50 border border-gray-300 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-purple-500 focus-within:border-purple-500 transition-shadow p-1">
        <textarea
          ref="messageInput"
          v-model="inputQuery"
          rows="1"
          placeholder="Pregunta sobre tus entrenos, sugiere cambios..."
          class="flex-grow bg-transparent border-none focus:ring-0 resize-none px-4 py-3 min-h-[44px] max-h-32 text-[15px] outline-none"
          @keydown.enter.prevent="handleEnter"
          @input="adjustTextareaHeight"
        ></textarea>

        <div class="px-2 py-2 flex items-center h-full">
          <button
            type="submit"
            :disabled="!inputQuery.trim() || isTyping"
            class="bg-purple-600 text-white p-2.5 rounded-lg hover:bg-purple-700 transition shadow-sm flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            <svg class="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path></svg>
          </button>
        </div>
      </form>
      <div class="text-center mt-2">
        <p class="text-[10px] text-gray-400">HevyTracker AI puede cometer errores. Considera revisar los consejos con un profesional.</p>
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
    // If loading fails, start fresh
    chatHistory.value = []
  } finally {
    historyLoading.value = false
  }
}

const clearHistory = async () => {
  if (!conversationId.value) return
  // Create a new conversation instead of deleting
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
    // slice(-7, -1) excludes the current message (last item) — it was already pushed
    // to chatHistory above, so we must not include it again in historyContext
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
  background-color: rgba(156, 163, 175, 0.5);
  border-radius: 10px;
}
</style>
