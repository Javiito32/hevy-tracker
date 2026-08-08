<template>
  <ClientOnly>
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="open"
          class="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4
                 bg-bg/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          @click.self="close"
        >
          <div
            class="bg-surface border border-line-strong w-full overflow-hidden flex flex-col
                   rounded-t-2xl sm:rounded-card max-h-[92vh] sm:max-h-[85vh]"
            :class="WIDTHS[size]"
          >
            <header class="px-5 py-3.5 border-b border-line flex items-start justify-between gap-4 flex-shrink-0">
              <div class="min-w-0">
                <h2 class="font-display text-sm font-semibold tracking-tight text-ink truncate">{{ title }}</h2>
                <p v-if="hint" class="text-xs text-ink-3 mt-1">{{ hint }}</p>
              </div>
              <button
                class="text-ink-3 hover:text-ink transition -mr-1 -mt-1 p-1 rounded"
                aria-label="Cerrar"
                @click="close"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </header>

            <div class="p-5 overflow-y-auto custom-scrollbar flex-grow">
              <slot />
            </div>

            <footer
              v-if="$slots.footer"
              class="px-5 py-3.5 border-t border-line flex items-center justify-end gap-2 flex-shrink-0"
            >
              <slot name="footer" />
            </footer>
          </div>
        </div>
      </Transition>
    </Teleport>
  </ClientOnly>
</template>

<script setup lang="ts">
/**
 * The dialog. Replaces 9 hand-rolled overlays that had already split into two
 * visual families — half used `bg-black/60` with no blur, half
 * `bg-slate-950/80 backdrop-blur-sm` — and only some of which could be
 * dismissed by clicking outside or closed with Escape.
 *
 * On phones it docks to the bottom edge instead of floating centred: a centred
 * dialog puts its actions under the on-screen keyboard, and this app is used
 * one-handed in a gym.
 */
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  hint?: string
  size?: keyof typeof WIDTHS
}>(), { size: 'md' })

const emit = defineEmits<{ close: [] }>()

const WIDTHS = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl'
} as const

const close = () => emit('close')

// Escape closes, and the page behind does not scroll while a dialog is open —
// on a phone, a scrolling backdrop makes the dialog feel detached from its
// trigger and loses the user's place in the list they came from.
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.open) close()
}

watch(() => props.open, (isOpen) => {
  if (import.meta.client) document.body.style.overflow = isOpen ? 'hidden' : ''
})

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (import.meta.client) document.body.style.overflow = ''
})
</script>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.15s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
