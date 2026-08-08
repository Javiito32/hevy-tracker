<template>
  <!-- The user gets a bubble; the coach gets a column.
       In an achromatic interface there is no "assistant violet" left to mark the
       reply with, so the two voices are separated structurally instead: the
       athlete's words sit right-aligned in a chip, and the coach's answer runs
       as a full-width block under a mono label. That also reads better, since
       the coach's replies are long and a 75%-wide bubble wraps them twice. -->
  <div class="mb-6">
    <div v-if="isUser" class="flex justify-end">
      <div class="max-w-[85%] sm:max-w-[75%] bg-surface-2 border border-line rounded-2xl rounded-tr-sm px-4 py-2.5">
        <!-- Plain text, not markdown: these are the athlete's own words, and an
             asterisk they typed should stay an asterisk. -->
        <p class="text-sm text-ink whitespace-pre-wrap">{{ content }}</p>
        <p v-if="timestamp" class="font-data text-[10px] text-ink-3 mt-1.5 text-right">{{ formatTime(timestamp) }}</p>
      </div>
    </div>

    <div v-else class="border-l-2 border-line pl-4">
      <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-1.5">Coach</p>

      <div class="md">
        <span v-html="renderMarkdown(content)" /><span
          v-if="streaming"
          class="inline-block w-1.5 h-4 -mb-0.5 ml-0.5 bg-ink animate-pulse"
        />
      </div>

      <p v-if="timestamp && !streaming" class="font-data text-[10px] text-ink-3 mt-2">
        {{ formatTime(timestamp) }}<span v-if="isAdmin && modelUsed"> · {{ modelUsed }}</span>
      </p>
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

const formatTime = (date: Date) =>
  new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(date)
</script>
