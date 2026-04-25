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
      <div
        class="prose prose-sm leading-relaxed"
        :class="{ 'prose-invert': true }"
        v-html="formattedContent"
      ></div>
      <div
        v-if="timestamp"
        :class="['text-[10px] mt-2 text-right opacity-50']"
      >
        {{ formatTime(timestamp) }}
      </div>
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
}>()

const isUser = computed(() => props.role === 'user')

const formattedContent = computed(() => {
  if (!props.content) return ''
  let html = props.content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/\n/g, '<br />')

  if (html.includes('<li>')) {
    html = html.replace(/(<li>.*<\/li>)/s, '<ul class="list-disc pl-4 space-y-1 my-2">$1</ul>')
  }

  return html
})

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
