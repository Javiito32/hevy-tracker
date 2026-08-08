<template>
  <div
    class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm pointer-events-none"
    role="status"
    aria-live="polite"
  >
    <TransitionGroup
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0 translate-y-2"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto rounded-xl border shadow-xl px-4 py-3 flex items-start gap-3 backdrop-blur"
        :class="STYLES[toast.kind].container"
      >
        <span class="text-sm leading-5 flex-shrink-0" aria-hidden="true">{{ STYLES[toast.kind].glyph }}</span>
        <p class="text-sm flex-1 min-w-0" :class="STYLES[toast.kind].text">{{ toast.message }}</p>
        <button
          @click="dismiss(toast.id)"
          class="text-slate-500 hover:text-slate-200 text-lg leading-none flex-shrink-0 transition"
          aria-label="Cerrar aviso"
        >×</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
const { toasts, dismiss } = useToast()

/** Glyph alongside colour so the kind survives a colour-blind reading. */
const STYLES = {
  success: {
    glyph: '✓',
    container: 'bg-emerald-950/90 border-emerald-800',
    text: 'text-emerald-200'
  },
  error: {
    glyph: '⚠',
    container: 'bg-rose-950/90 border-rose-800',
    text: 'text-rose-200'
  },
  info: {
    glyph: 'ℹ',
    container: 'bg-slate-900/95 border-slate-700',
    text: 'text-slate-200'
  }
} as const
</script>
