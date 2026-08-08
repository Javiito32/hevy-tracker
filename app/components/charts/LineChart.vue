<template>
  <div class="relative w-full select-none">
    <div v-if="!points.length" class="flex items-center justify-center h-40 text-ink-3 text-sm">
      Sin datos suficientes para mostrar la gráfica.
    </div>
    <svg
      v-else
      :viewBox="`0 0 ${W} ${H}`"
      class="w-full overflow-visible"
      :style="`height: ${H}px`"
      @mousemove="onMouseMove"
      @mouseleave="hoveredIndex = null"
    >
      <!-- Y grid lines + labels. Chrome is drawn with the theme tokens through
           Tailwind's stroke/fill utilities: a presentation attribute cannot
           take a `var()`, which is why these are classes and not attributes. -->
      <g v-for="(tick, i) in yTicks" :key="`y${i}`">
        <line
          :x1="PAD_L" :y1="yScale(tick)"
          :x2="W - PAD_R" :y2="yScale(tick)"
          class="stroke-line" stroke-width="1"
        />
        <text
          :x="PAD_L - 6" :y="yScale(tick) + 4"
          text-anchor="end" font-size="10" class="fill-ink-3 font-data"
        >{{ formatY(tick) }}</text>
      </g>

      <!-- X axis labels -->
      <g v-for="(pt, i) in xTickPoints" :key="`x${i}`">
        <text
          :x="xScale(i_to_x(pt.i))" :y="H - 4"
          text-anchor="middle" font-size="10" class="fill-ink-3 font-data"
        >{{ formatDate(pt.date) }}</text>
      </g>

      <!-- Trend line (linear regression). Told apart from the series by its
           dash and weight rather than by a second hue. -->
      <line
        v-if="trend && points.length > 2"
        :x1="xScale(0)" :y1="yScale(trend.start)"
        :x2="xScale(points.length - 1)" :y2="yScale(trend.end)"
        :style="{ stroke: trendColor }"
        stroke-width="1.5" stroke-dasharray="5,4" opacity="0.8"
      />

      <!-- Area fill -->
      <path
        v-if="showArea"
        :d="areaPath"
        :style="{ fill: color }" fill-opacity="0.08"
      />

      <!-- Main line -->
      <polyline
        :points="polylinePoints"
        :style="{ stroke: color }"
        stroke-width="2" fill="none"
        stroke-linecap="round" stroke-linejoin="round"
      />

      <!-- Data points. The ring is a knockout in the card surface, so it has to
           follow the theme: hardcoded to #0f172a it drew a black halo around
           every point once the surface turned to chalk. -->
      <g v-for="(pt, i) in points" :key="`pt${i}`">
        <circle
          :cx="xScale(i)" :cy="yScale(pt.value)"
          r="3.5" :style="{ fill: color }" class="stroke-surface cursor-pointer" stroke-width="1.5"
          :opacity="hoveredIndex === i ? 1 : 0.75"
        />
      </g>

      <!-- Hover vertical line -->
      <line
        v-if="hoveredIndex !== null"
        :x1="xScale(hoveredIndex)" y1="0"
        :x2="xScale(hoveredIndex)" :y2="H - PAD_B"
        class="stroke-line-strong" stroke-width="1" stroke-dasharray="3,2"
      />
    </svg>

    <!-- Tooltip -->
    <div
      v-if="hoveredIndex !== null && points[hoveredIndex]"
      class="absolute pointer-events-none bg-surface border border-line-strong text-ink
             text-xs px-2.5 py-1.5 rounded z-20 whitespace-nowrap"
      :style="tooltipStyle"
    >
      <div class="font-data font-semibold">{{ formatY(points[hoveredIndex].value) }}</div>
      <div class="font-data text-ink-3">{{ formatDate(points[hoveredIndex].date) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

interface Point { date: string; value: number }

const props = withDefaults(defineProps<{
  points: Point[]
  color?: string
  trendColor?: string
  showArea?: boolean
  showTrend?: boolean
  formatY?: (v: number) => string
  H?: number
}>(), {
  // Any CSS colour, so callers can pass a theme token — `rgb(var(--ink))` — and
  // have the series follow light and dark. A single-series chart in this app is
  // ink on the card, not a blue line: the palette is spent on verdicts.
  color: 'rgb(var(--ink))',
  trendColor: 'rgb(var(--ink-3))',
  showArea: true,
  showTrend: true,
  formatY: (v: number) => v.toFixed(1),
  H: 200
})

const W = 600
const PAD_L = 48
const PAD_R = 16
const PAD_T = 16
const PAD_B = 36

const chartW = W - PAD_L - PAD_R
const chartH = computed(() => props.H - PAD_T - PAD_B)

const minVal = computed(() => Math.min(...props.points.map(p => p.value)))
const maxVal = computed(() => Math.max(...props.points.map(p => p.value)))
const valRange = computed(() => Math.max(maxVal.value - minVal.value, 1))
const padded_min = computed(() => minVal.value - valRange.value * 0.1)
const padded_max = computed(() => maxVal.value + valRange.value * 0.1)

const xScale = (i: number) => PAD_L + (props.points.length <= 1 ? chartW / 2 : (i / (props.points.length - 1)) * chartW)
const yScale = (v: number) => PAD_T + ((padded_max.value - v) / (padded_max.value - padded_min.value)) * chartH.value

const polylinePoints = computed(() =>
  props.points.map((p, i) => `${xScale(i)},${yScale(p.value)}`).join(' ')
)

const areaPath = computed(() => {
  if (!props.points.length) return ''
  const bottom = PAD_T + chartH.value
  const pts = props.points.map((p, i) => `${xScale(i)},${yScale(p.value)}`).join(' ')
  return `M ${xScale(0)},${bottom} L ${props.points.map((p, i) => `${xScale(i)},${yScale(p.value)}`).join(' L ')} L ${xScale(props.points.length - 1)},${bottom} Z`
})

// Y axis ticks (4 ticks)
const yTicks = computed(() => {
  const step = (padded_max.value - padded_min.value) / 4
  return Array.from({ length: 5 }, (_, i) => padded_min.value + step * i)
})

// X axis: show up to 6 evenly spaced labels
const xTickPoints = computed(() => {
  const n = props.points.length
  if (n === 0) return []
  const count = Math.min(6, n)
  const step = Math.floor((n - 1) / Math.max(count - 1, 1))
  const indices = new Set<number>()
  for (let k = 0; k < count; k++) indices.add(Math.min(k * step, n - 1))
  return Array.from(indices).map(i => ({ i, date: props.points[i].date }))
})

const i_to_x = (i: number) => i

// Linear regression trend
const trend = computed(() => {
  if (!props.showTrend || props.points.length < 3) return null
  const n = props.points.length
  const xs = Array.from({ length: n }, (_, i) => i)
  const ys = props.points.map(p => p.value)
  const sx = xs.reduce((a, b) => a + b, 0)
  const sy = ys.reduce((a, b) => a + b, 0)
  const sxy = xs.reduce((acc, x, i) => acc + x * ys[i], 0)
  const sx2 = xs.reduce((acc, x) => acc + x * x, 0)
  const m = (n * sxy - sx * sy) / (n * sx2 - sx * sx)
  const b = (sy - m * sx) / n
  return { start: b, end: m * (n - 1) + b }
})

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

// Hover logic
const hoveredIndex = ref<number | null>(null)
const tooltipStyle = ref('')

const onMouseMove = (e: MouseEvent) => {
  const svg = (e.currentTarget as SVGElement)
  const rect = svg.getBoundingClientRect()
  const scaleX = W / rect.width
  const mouseX = (e.clientX - rect.left) * scaleX
  let closest = 0
  let minDist = Infinity
  props.points.forEach((_, i) => {
    const dx = Math.abs(xScale(i) - mouseX)
    if (dx < minDist) { minDist = dx; closest = i }
  })
  hoveredIndex.value = closest
  const px = (xScale(closest) / W) * 100
  const side = px > 70 ? 'right' : 'left'
  tooltipStyle.value = side === 'left'
    ? `left: calc(${px}% + 8px); top: 4px;`
    : `right: calc(${100 - px}% + 8px); top: 4px;`
}
</script>
