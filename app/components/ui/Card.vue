<template>
  <section class="bg-surface border border-line rounded-card" :class="!flush && 'overflow-hidden'">
    <!-- The header only exists when something fills it. A card that is just a
         container should not grow an empty bar. -->
    <header
      v-if="eyebrow || title || $slots.header || $slots.actions"
      class="px-5 py-3.5 border-b border-line flex items-start justify-between gap-4 flex-wrap"
    >
      <div class="min-w-0">
        <slot name="header">
          <!-- The eyebrow names the family the card belongs to; the title names
               this one. Set in the display face, tracked out and in caps, it
               reads as the engraved label on an instrument panel. -->
          <p v-if="eyebrow" class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-1">
            {{ eyebrow }}
          </p>
          <h2 v-if="title" class="font-display text-sm font-semibold tracking-tight text-ink truncate">
            {{ title }}
          </h2>
          <p v-if="hint" class="text-xs text-ink-3 mt-1">{{ hint }}</p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="flex items-center gap-2 flex-shrink-0">
        <slot name="actions" />
      </div>
    </header>

    <div :class="flush ? '' : padded ? 'p-5' : ''">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="px-5 py-3 border-t border-line text-xs text-ink-3">
      <slot name="footer" />
    </footer>
  </section>
</template>

<script setup lang="ts">
/**
 * The card. It replaces ~70 hand-written copies of
 * `bg-slate-900 rounded-xl border border-slate-800 …` and the 30 copies of the
 * `px-6 py-4 border-b border-slate-800` header that sat inside them.
 *
 * No shadow: in the «Instrumento» direction a panel is defined by a hairline
 * and a change of surface, not by floating above the page. Shadows on a near
 * black ground read as smudges anyway.
 */
withDefaults(defineProps<{
  /** Small caps label above the title — the family this card belongs to. */
  eyebrow?: string
  title?: string
  /** One line under the title. Use for the caveat, not for a second title. */
  hint?: string
  /** Drop the body padding — for tables and charts that bleed to the edge. */
  flush?: boolean
  /** Body padding, on by default. */
  padded?: boolean
}>(), { padded: true })
</script>
