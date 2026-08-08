<template>
  <header class="mb-7 flex items-end justify-between gap-4 flex-wrap">
    <div class="min-w-0">
      <p
        v-if="eyebrow"
        class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-1.5"
      >{{ eyebrow }}</p>
      <h1 class="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] text-ink leading-none">
        {{ title }}
      </h1>
      <p v-if="subtitle" class="text-sm text-ink-3 mt-2">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="flex items-center gap-2 flex-shrink-0">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * Page title. Thirteen of the nineteen pages opened with exactly
 * `text-3xl font-bold text-slate-100`, and the rest each did their own thing.
 *
 * Set in the display face with negative tracking rather than at `text-3xl bold`:
 * a heavy grotesque tightened up reads as engraved rather than shouted, which
 * is the register this direction wants.
 */
defineProps<{
  title: string
  /** The section this page belongs to. */
  eyebrow?: string
  subtitle?: string
}>()
</script>
