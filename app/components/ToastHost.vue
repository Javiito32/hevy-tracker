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
        class="pointer-events-auto rounded-card border bg-surface px-4 py-3 flex items-start gap-3"
        :class="STYLES[toast.kind].container"
      >
        <span class="text-sm leading-5 flex-shrink-0" :class="STYLES[toast.kind].text" aria-hidden="true">
          {{ STYLES[toast.kind].glyph }}
        </span>
        <p class="text-sm flex-1 min-w-0 text-ink">{{ toast.message }}</p>
        <button
          class="text-ink-3 hover:text-ink text-lg leading-none flex-shrink-0 transition"
          aria-label="Cerrar aviso"
          @click="dismiss(toast.id)"
        >×</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
const { toasts, dismiss } = useToast()

/**
 * Glyph alongside colour so the kind survives a colour-blind reading.
 *
 * The toast body is a plain surface with a hairline; only the glyph and the
 * left border carry the hue. A fully tinted panel was legible on the old dark-
 * only theme but on chalk it reads as a coloured block with text in it, and it
 * spent a verdict colour on what is mostly just a receipt.
 */
const STYLES = {
  success: { glyph: '✓', container: 'border-positive/40', text: 'text-positive' },
  error:   { glyph: '⚠', container: 'border-danger/40',   text: 'text-danger' },
  info:    { glyph: 'ℹ', container: 'border-line-strong', text: 'text-ink-3' }
} as const
</script>
