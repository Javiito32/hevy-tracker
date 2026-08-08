<template>
  <div class="px-5 py-12 text-center">
    <p class="font-display text-sm font-semibold tracking-tight text-ink">{{ title }}</p>
    <p v-if="description" class="text-sm text-ink-3 mt-1.5 max-w-sm mx-auto">{{ description }}</p>
    <div v-if="$slots.default || action" class="mt-5 flex justify-center">
      <slot>
        <UiButton v-if="action && to" :to="to" size="sm" variant="secondary">{{ action }}</UiButton>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The empty state. Replaces ~25 hand-written ones whose padding ranged from
 * `p-6` to `p-20` for no reason anybody could reconstruct.
 *
 * An empty screen is an invitation to act, so `title` states the situation and
 * the action says what to do about it. No icon: a dimmed glyph in the middle of
 * an empty card is decoration standing in for an answer.
 */
defineProps<{
  title: string
  description?: string
  /** Label for the built-in link button. Use the slot for anything richer. */
  action?: string
  to?: string
}>()
</script>
