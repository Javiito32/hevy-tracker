<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
    :class="style.chip"
  >
    <span v-if="glyph" aria-hidden="true">{{ glyph }}</span>
    <slot>{{ fallbackLabel }}</slot>
  </span>
</template>

<script setup lang="ts">
import type { Verdict } from '~/utils/theme'

/**
 * Status pill. Replaces three separate copies of the same lookup that had
 * quietly disagreed — `completed` rendered slate-500 on one page, slate-400 on
 * another and indigo on a third, for the same mesocycle.
 *
 * The single source is `STATUS_STYLES` / `VERDICT_STYLES` in `app/utils/theme.ts`.
 */
const props = withDefaults(defineProps<{
  /** `status` reads the lifecycle map; anything else is a verdict. */
  tone?: 'status' | Verdict
  /** Only meaningful with `tone="status"`. */
  status?: string | null
  /**
   * Show the non-colour cue. On by default for verdicts, where colour must
   * never be the only signal; off for lifecycle status, whose written word is
   * already the signal.
   */
  showGlyph?: boolean
}>(), { tone: 'status' })

const isStatus = computed(() => props.tone === 'status')

const style = computed(() =>
  isStatus.value ? statusStyle(props.status) : VERDICT_STYLES[props.tone as Verdict]
)

const fallbackLabel = computed(() => (isStatus.value ? statusStyle(props.status).label : ''))

const glyph = computed(() => {
  if (isStatus.value) return props.showGlyph ? '●' : ''
  return props.showGlyph === false ? '' : VERDICT_STYLES[props.tone as Verdict].glyph
})
</script>
