<template>
  <div>
    <p v-if="label" class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-1.5">
      {{ label }}
    </p>
    <p class="flex items-baseline gap-1.5 flex-wrap">
      <span class="font-data text-2xl leading-none text-ink">
        <slot>{{ display }}</slot>
      </span>
      <span v-if="unit" class="text-xs text-ink-3">{{ unit }}</span>

      <!-- The delta carries an arrow as well as a colour, and its polarity is
           declared by the caller: +2 kg of body weight is progress in a bulk and
           a problem in a cut, and a rising resting heart rate is never good. -->
      <span
        v-if="delta !== null && delta !== undefined && delta !== 0"
        class="font-data text-xs flex items-center gap-0.5 ml-1"
        :class="deltaClass(delta, polarity)"
      >
        <span aria-hidden="true">{{ deltaGlyph(delta) }}</span>
        {{ formatDelta(delta) }}<template v-if="deltaUnit">{{ deltaUnit }}</template>
      </span>
    </p>
    <p v-if="hint" class="text-xs text-ink-3 mt-1.5">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
import type { Polarity } from '~/utils/theme'

/**
 * A single measured figure. The number is set in the data face so a column of
 * these lines up, which is the whole reason this app has a monospaced role.
 *
 * `NO_VALUE` (—) when there is nothing to show: a figure that cannot be
 * computed is never rendered as 0, a rule this codebase already follows for
 * unpriced AI rows and for missing micronutrients.
 */
const props = withDefaults(defineProps<{
  label?: string
  value?: number | string | null
  unit?: string
  delta?: number | null
  deltaUnit?: string
  polarity?: Polarity
  hint?: string
  decimals?: number
}>(), { polarity: 'up-good', decimals: 0 })

const display = computed(() => {
  if (props.value === null || props.value === undefined || props.value === '') return NO_VALUE
  if (typeof props.value === 'string') return props.value
  return props.value.toLocaleString('es-ES', {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals
  })
})

const formatDelta = (d: number) =>
  Math.abs(d).toLocaleString('es-ES', { maximumFractionDigits: 1 })
</script>
