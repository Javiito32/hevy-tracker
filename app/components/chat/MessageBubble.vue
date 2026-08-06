<template>
  <div :class="['flex w-full mb-6', isUser ? 'justify-end' : 'justify-start']">
    <!-- Assistant Avatar -->
    <div v-if="!isUser" class="flex-shrink-0 mr-3 mt-1">
      <div class="w-8 h-8 bg-violet-950 rounded-full flex items-center justify-center text-violet-400 text-sm ring-1 ring-violet-800">
        🤖
      </div>
    </div>

    <!-- Message Content -->
    <div
      :class="[
        'max-w-[85%] sm:max-w-[75%] rounded-2xl px-5 py-3 shadow-sm',
        isUser
          ? 'bg-indigo-600 text-white rounded-tr-sm'
          : 'bg-slate-800 border border-slate-700 text-slate-100 rounded-tl-sm'
      ]"
    >
      <div class="prose prose-sm prose-invert leading-relaxed max-w-none">
        <span v-html="renderMarkdown(content)"></span><span
          v-if="streaming"
          class="inline-block w-1.5 h-4 -mb-0.5 ml-0.5 bg-violet-400 animate-pulse"
        ></span>
      </div>
      <div
        v-if="timestamp && !streaming"
        :class="['text-[10px] mt-2 text-right opacity-50']"
      >
        {{ formatTime(timestamp) }}
      </div>
      <p v-if="!isUser && isAdmin && modelUsed && !streaming" class="text-[10px] font-mono text-slate-600 mt-1">Modelo: {{ modelUsed }}</p>
    </div>

    <!-- User Avatar -->
    <div v-if="isUser" class="flex-shrink-0 ml-3 mt-1">
      <div class="w-8 h-8 bg-indigo-950 rounded-full flex items-center justify-center text-indigo-400 font-bold text-xs ring-1 ring-indigo-800">
        TU
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
  timestamp?: Date
  modelUsed?: string
  /** Reply still arriving: shows a caret and hides the timestamp/model footer. */
  streaming?: boolean
}>()

const { session } = useUserSession()
const isAdmin = computed(() => (session.value?.user as any)?.role === 'admin')

const isUser = computed(() => props.role === 'user')

const formatTime = (date: Date) => {
  return new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(date)
}
</script>

<style>
.prose p {
  margin-top: 0.5em;
  margin-bottom: 0.5em;
}
.prose p:first-child {
  margin-top: 0;
}
.prose p:last-child {
  margin-bottom: 0;
}
</style>
