<template>
  <div class="w-full">
    <!-- Readout. The figure is set in the data face at a size that can be read
         at arm's length, with the written verdict beside it so the bar's colour
         is never the only thing saying how it went. -->
    <div v-if="showReadout" class="flex items-baseline justify-between gap-3 mb-1.5">
      <p class="font-data text-lg leading-none text-ink">
        {{ formatValue(value) }}<span v-if="unit" class="text-xs text-ink-3 ml-1">{{ unit }}</span>
      </p>
      <p v-if="caption" class="text-[11px] flex items-center gap-1" :class="style.text">
        <span aria-hidden="true">{{ style.glyph }}</span>{{ caption }}
      </p>
    </div>

    <div
      class="relative"
      role="meter"
      :aria-valuenow="value"
      :aria-valuemin="0"
      :aria-valuemax="max"
      :aria-label="ariaLabel"
    >
      <!-- The track. -->
      <div class="relative h-2.5 bg-surface-2 rounded-sm overflow-hidden">
        <div
          class="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-300"
          :class="FILLS[verdict]"
          :style="{ width: pct(value) }"
        />
      </div>

      <!-- Graduations. The rule is the point: a bar alone says "some"; a bar
           against marks says "this much, out of this". -->
      <div
        class="tick-rule h-1.5 mt-px"
        :style="{ '--tick-step': minorStepPct }"
        aria-hidden="true"
      />

      <!-- Landmarks (MEV / MAV / MRV, a target, a previous best). Drawn over the
           track as full-height marks so the fill can be read against them. -->
      <template v-for="mark in visibleLandmarks" :key="mark.label">
        <span
          class="absolute top-0 w-px bg-tick"
          :style="{ left: pct(mark.value), height: '0.875rem' }"
          :title="mark.label"
          aria-hidden="true"
        />
      </template>
    </div>

    <!-- Landmark labels. Positioned under their own mark rather than in a
         legend: a legend would make the reader map three names onto three
         positions themselves. -->
    <div v-if="visibleLandmarks.length" class="relative h-4 mt-1" aria-hidden="true">
      <span
        v-for="mark in visibleLandmarks"
        :key="mark.label"
        class="absolute font-data text-[9px] uppercase tracking-wide text-ink-3 -translate-x-1/2 whitespace-nowrap"
        :style="{ left: pct(mark.value) }"
      >{{ mark.short ?? mark.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Verdict } from '~/utils/theme'

/**
 * THE SIGNATURE — the graduated rule.
 *
 * A gym is quantised to 2.5 kg, and this app already rounds every suggested
 * load to that increment. So every magnitude that is judged against a threshold
 * is drawn here on a rule with major and minor graduations, the way a scale or
 * a caliper reads, instead of as a bare progress bar.
 *
 * Where it is used: weekly sets against MEV/MAV/MRV, plan adherence against
 * what was prescribed, macros against target, sessions against the weekly goal.
 *
 * Where it is NOT used: as a divider, a card header flourish, or anywhere there
 * is no threshold. A motif that shows up everywhere stops meaning anything —
 * the ticks have to keep earning their place by measuring something.
 */
export interface Landmark {
  value: number
  /** Full name, used as the mark's title. */
  label: string
  /** Abbreviation printed under the mark. */
  short?: string
}

const props = withDefaults(defineProps<{
  value: number
  max: number
  landmarks?: Landmark[]
  verdict?: Verdict
  unit?: string
  /** Written verdict shown beside the figure. Colour never travels alone. */
  caption?: string
  /** Value interval between minor graduations. Defaults to a tenth of the scale. */
  step?: number
  showReadout?: boolean
  /** Decimals in the readout. Sets and reps are whole; kg and grams are not. */
  decimals?: number
  ariaLabel?: string
}>(), { verdict: 'neutral', landmarks: () => [], showReadout: true, decimals: 0 })

const FILLS: Record<Verdict, string> = {
  positive: 'bg-positive',
  warn: 'bg-warn',
  danger: 'bg-danger',
  // Neutral is the common case: most bars are just "how far along", not a
  // verdict, and painting those green would spend the palette on nothing.
  neutral: 'bg-ink-2'
}

const style = computed(() => verdictStyle(props.verdict))

const pct = (v: number) => `${Math.min(100, Math.max(0, (v / (props.max || 1)) * 100))}%`

const minorStepPct = computed(() => {
  const step = props.step && props.step > 0 ? props.step : (props.max || 1) / 10
  const p = (step / (props.max || 1)) * 100
  // Below ~2% the marks merge into a solid band and stop reading as a rule.
  return `${Math.max(2, p)}%`
})

/** A landmark past the end of the scale would pin to the edge and misreport. */
const visibleLandmarks = computed(() =>
  props.landmarks.filter(m => m.value > 0 && m.value <= props.max)
)

const formatValue = (v: number) =>
  v.toLocaleString('es-ES', { minimumFractionDigits: props.decimals, maximumFractionDigits: props.decimals })
</script>
