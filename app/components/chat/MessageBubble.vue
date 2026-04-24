<template>
  <div :class="['flex w-full mb-6', isUser ? 'justify-end' : 'justify-start']">
    <!-- Assistant Avatar -->
    <div v-if="!isUser" class="flex-shrink-0 mr-3 mt-1">
      <div class="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 text-sm shadow-sm ring-1 ring-purple-200">
        🤖
      </div>
    </div>

    <!-- Message Content -->
    <div 
      :class="[
        'max-w-[85%] sm:max-w-[75%] rounded-2xl px-5 py-3 shadow-sm',
        isUser 
          ? 'bg-blue-600 text-white rounded-tr-sm' 
          : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
      ]"
    >
      <div 
        class="prose prose-sm leading-relaxed" 
        :class="{ 'prose-invert': isUser, 'text-gray-800': !isUser }" 
        v-html="formattedContent"
      ></div>
      <div 
        v-if="timestamp" 
        :class="['text-[10px] mt-2 text-right opacity-70']"
      >
        {{ formatTime(timestamp) }}
      </div>
    </div>

    <!-- User Avatar -->
    <div v-if="isUser" class="flex-shrink-0 ml-3 mt-1">
      <div class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-xs ring-1 ring-blue-200">
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

// Basic markdown-to-html formatter for the MVP
const formattedContent = computed(() => {
  if (!props.content) return ''
  let html = props.content
    // Replace strong
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Replace italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Replace lists
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    // Replace linebreaks
    .replace(/\n/g, '<br />')
  
  // Wrap li's in ul (very naive implementation for display purposes)
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
/* Adjust spacing for paragraph tags injected by string replacer or pure html */
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
