<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden mb-6">
    <div class="px-5 py-3.5 border-b border-line flex flex-wrap items-center gap-3">
      <div>
        <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Evolución del gasto</h2>
        <p class="text-xs text-ink-3 mt-0.5">
          {{ granularityLabel }} · {{ metric === 'cost' ? 'coste por modelo' : 'tokens por modelo' }}
        </p>
      </div>

      <div class="flex items-center gap-2 ml-auto">
        <!-- Changes the encoding, not the data slice: the range filter above the
             page still scopes everything. -->
        <div class="flex gap-1 bg-surface-2 rounded-lg p-1">
          <button v-for="m in METRICS" :key="m.key" @click="metric = m.key"
            :class="metric === m.key ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:text-ink'"
            class="px-3 py-1 rounded-md text-xs font-medium transition">
            {{ m.label }}
          </button>
        </div>
        <button @click="showTable = !showTable"
          class="text-xs text-ink-3 hover:text-ink-2 transition px-2 py-1">
          {{ showTable ? 'Ver gráfico' : 'Ver tabla' }}
        </button>
      </div>
    </div>

    <div v-if="pending" class="py-10 flex justify-center text-ink-3"><UiSpinner /></div>
    <div v-else-if="!hasData" class="p-8 text-center text-ink-3 text-sm">
      <p>Sin datos para este periodo.</p>
      <p v-if="metric === 'cost' && totalTokens > 0" class="text-xs text-warn/80 mt-2">
        Hay {{ formatTokens(totalTokens) }} tokens registrados pero ningún coste calculable —
        configura el precio de los modelos más arriba.
      </p>
    </div>

    <!-- Table view: the WCAG-clean twin of the chart, so no value is reachable
         only by hovering. -->
    <div v-else-if="showTable" class="overflow-x-auto max-h-96">
      <table class="w-full text-sm">
        <thead class="bg-surface-2 text-ink-3 uppercase text-[11px] tracking-wide sticky top-0">
          <tr>
            <th class="px-4 py-2 text-left">{{ granularity === 'week' ? 'Semana' : 'Día' }}</th>
            <th v-for="s in series" :key="s.key" class="px-4 py-2 text-right">{{ s.label }}</th>
            <th class="px-4 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="b in nonEmptyBuckets" :key="b.date" class="hover:bg-surface-2">
            <td class="px-4 py-2 text-ink-2 font-data">{{ formatBucketDate(b.date) }}</td>
            <td v-for="s in series" :key="s.key" class="px-4 py-2 text-right text-ink-2 font-data">
              {{ cellText(b, s.key) }}
            </td>
            <td class="px-4 py-2 text-right text-ink font-medium font-data">{{ totalText(b) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="px-4 pt-4 pb-2">
      <div class="relative" @mouseleave="hovered = null">
        <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" :style="`height:${H}px`" role="img"
          :aria-label="`Gasto de IA por ${granularity === 'week' ? 'semana' : 'día'}`">
          <!-- Y gridlines: solid hairlines, one step off the surface. -->
          <g v-for="tick in yTicks" :key="`y${tick}`">
            <line :x1="PAD_L" :y1="yScale(tick)" :x2="W - PAD_R" :y2="yScale(tick)"
              class="stroke-line" stroke-width="1" />
            <text :x="PAD_L - 8" :y="yScale(tick) + 4" text-anchor="end" font-size="10"
              class="fill-ink-3 font-data">{{ formatAxis(tick) }}</text>
          </g>

          <!-- Baseline -->
          <line :x1="PAD_L" :y1="yScale(0)" :x2="W - PAD_R" :y2="yScale(0)"
            class="stroke-line-strong" stroke-width="1" />

          <!-- Stacked columns. Hit area spans the whole band so hovering never
               requires landing on a thin bar. -->
          <g v-for="(b, i) in buckets" :key="b.date">
            <rect :x="bandX(i)" y="0" :width="bandWidth" :height="H - PAD_B"
              fill="transparent" @mouseenter="hovered = i" />
            <rect v-if="hovered === i" :x="bandX(i)" y="0" :width="bandWidth" :height="H - PAD_B"
              class="fill-ink" fill-opacity="0.05" pointer-events="none" />
            <path v-for="seg in segmentsOf(b, i)" :key="seg.key" :d="seg.path" :fill="seg.color"
              pointer-events="none" />
          </g>

          <!-- X labels: thinned so they never collide. -->
          <g v-for="i in xTickIndexes" :key="`x${i}`">
            <text :x="bandX(i) + bandWidth / 2" :y="H - 8" text-anchor="middle" font-size="10"
              class="fill-ink-3 font-data">{{ formatBucketDate(buckets[i]!.date, true) }}</text>
          </g>
        </svg>

        <div v-if="hovered !== null && buckets[hovered]"
          class="absolute pointer-events-none bg-bg border border-line-strong rounded-lg px-3 py-2 z-10 min-w-[10rem]"
          :style="tooltipStyle">
          <p class="text-xs font-semibold text-ink mb-1.5">{{ formatBucketDate(buckets[hovered]!.date) }}</p>
          <div v-for="s in seriesInBucket(buckets[hovered]!)" :key="s.key"
            class="flex items-center justify-between gap-4 text-xs py-0.5">
            <span class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-sm inline-block" :style="{ background: colorOf(s) }"></span>
              <span class="text-ink-2">{{ s.label }}</span>
            </span>
            <span class="text-ink font-data">{{ cellText(buckets[hovered]!, s.key) }}</span>
          </div>
          <div class="flex items-center justify-between gap-4 text-xs pt-1.5 mt-1 border-t border-line">
            <span class="text-ink-3">Total</span>
            <span class="text-ink font-medium font-data">{{ totalText(buckets[hovered]!) }}</span>
          </div>
          <p class="text-xs text-ink-3 mt-1">{{ buckets[hovered]!.interactions }} interacciones</p>
        </div>
      </div>

      <!-- Legend: always present for 2+ series, so identity is never colour-alone. -->
      <div v-if="series.length > 1" class="flex flex-wrap items-center gap-4 px-2 pt-2">
        <span v-for="s in series" :key="s.key" class="flex items-center gap-1.5 text-xs text-ink-2">
          <span class="w-2.5 h-2.5 rounded-sm inline-block" :style="{ background: colorOf(s) }"></span>
          <span class="font-mono">{{ s.label }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Cost/token trend as stacked columns, one band per day (or per week once the
 * range outgrows a daily axis).
 *
 * Series colours come from the shared validated palette (`app/utils/series.ts`,
 * one selected step per theme) and are keyed to `color_index`, which the API
 * pins to the model's all-time position — the bands must not repaint when the
 * date filter changes.
 */
interface Cell { cost: number; tokens: number; input: number; output: number; interactions: number }
interface Bucket { date: string; values: Record<string, Cell>; cost: number; tokens: number; interactions: number }
interface Series { key: string; label: string; color_index: number }

const props = defineProps<{
  buckets: Bucket[]
  series: Series[]
  granularity: 'day' | 'week'
  pending?: boolean
}>()

const METRICS = [
  { key: 'cost' as const, label: 'Coste' },
  { key: 'tokens' as const, label: 'Tokens' }
]

const metric = ref<'cost' | 'tokens'>('cost')
const showTable = ref(false)
const hovered = ref<number | null>(null)

/**
 * Categorical slots, now off the shared palette in `app/utils/series.ts`.
 *
 * These were five hexes validated against one surface (#0f172a). Held here they
 * could only ever be right for one theme, and `utils/nutrition.ts` kept a second
 * private copy of the same idea. Both now resolve from the same CSS variables,
 * which carry a selected step per theme.
 */
const SERIES_COLORS = Array.from({ length: SERIES_SLOTS }, (_, i) => seriesColor(i))
/** The folded tail is deliberately outside the palette — it is not an identity. */
const OTHER_COLOR = SERIES_OTHER

const W = 800
const H = 260
const PAD_L = 52
const PAD_R = 12
const PAD_B = 28
const PAD_T = 12
/** Cap the mark; the band's leftover width stays as air. */
const MAX_BAR = 24
/** Surface-coloured gap that separates stacked segments. */
const SEG_GAP = 2

const buckets = computed(() => props.buckets ?? [])
const series = computed(() => props.series ?? [])
const granularity = computed(() => props.granularity)

const granularityLabel = computed(() => (granularity.value === 'week' ? 'Por semana' : 'Por día'))

const valueOf = (cell: Cell | undefined) => (!cell ? 0 : metric.value === 'cost' ? cell.cost : cell.tokens)
const bucketTotal = (b: Bucket) => (metric.value === 'cost' ? b.cost : b.tokens)

const totalTokens = computed(() => buckets.value.reduce((s, b) => s + b.tokens, 0))
const maxValue = computed(() => Math.max(0, ...buckets.value.map(bucketTotal)))
const hasData = computed(() => maxValue.value > 0)

const nonEmptyBuckets = computed(() => buckets.value.filter(b => bucketTotal(b) > 0))

// ── Scales ────────────────────────────────────────────────────────────────────

const plotW = W - PAD_L - PAD_R
const plotH = computed(() => H - PAD_B - PAD_T)
const bandWidth = computed(() => (buckets.value.length ? plotW / buckets.value.length : plotW))
const barWidth = computed(() => Math.min(MAX_BAR, bandWidth.value * 0.7))

const bandX = (i: number) => PAD_L + i * bandWidth.value

/** Axis top rounded up to a clean number so ticks read 0 / 0,5 / 1 rather than 0,37. */
const niceMax = computed(() => {
  if (maxValue.value <= 0) return 1
  const exp = Math.floor(Math.log10(maxValue.value))
  const base = Math.pow(10, exp)
  const step = [1, 2, 2.5, 5, 10].find(s => maxValue.value <= s * base) ?? 10
  return step * base
})

const yScale = (v: number) => PAD_T + plotH.value - (v / niceMax.value) * plotH.value
const yTicks = computed(() => [0, 0.25, 0.5, 0.75, 1].map(f => f * niceMax.value))

/** ~8 x labels max, evenly spaced, always including the last bucket. */
const xTickIndexes = computed(() => {
  const n = buckets.value.length
  if (!n) return []
  const stride = Math.max(1, Math.ceil(n / 8))
  const idx: number[] = []
  for (let i = n - 1; i >= 0; i -= stride) idx.unshift(i)
  return idx
})

// ── Marks ─────────────────────────────────────────────────────────────────────

const colorOf = (s: Series) =>
  s.color_index < 0 ? OTHER_COLOR : SERIES_COLORS[s.color_index % SERIES_COLORS.length]!

/** Series present in a bucket, in the stable series order. */
const seriesInBucket = (b: Bucket) => series.value.filter(s => valueOf(b.values[s.key]) > 0)

/**
 * Stacked segments for one band, bottom-up.
 *
 * The topmost segment gets a 4px rounded cap and every segment sits on a square
 * baseline; separation is the 2px surface gap, never a stroke.
 */
const segmentsOf = (b: Bucket, i: number) => {
  const present = seriesInBucket(b)
  const x = bandX(i) + (bandWidth.value - barWidth.value) / 2
  const w = barWidth.value
  const r = 4

  let cursor = 0
  return present.map((s, idx) => {
    const value = valueOf(b.values[s.key])
    const y0 = yScale(cursor)
    cursor += value
    const y1 = yScale(cursor)
    const isTop = idx === present.length - 1
    // The gap eats into the top of each segment; the last one keeps its full
    // height so the stack still measures the true total against the axis.
    const rawH = y0 - y1
    const h = isTop ? rawH : Math.max(1, rawH - SEG_GAP)
    const top = y0 - h
    const radius = isTop ? Math.min(r, h / 2) : 0

    const path = radius > 0
      ? `M${x},${y0} L${x},${top + radius} Q${x},${top} ${x + radius},${top} L${x + w - radius},${top} Q${x + w},${top} ${x + w},${top + radius} L${x + w},${y0} Z`
      : `M${x},${y0} L${x},${top} L${x + w},${top} L${x + w},${y0} Z`

    return { key: s.key, path, color: colorOf(s) }
  })
}

const tooltipStyle = computed(() => {
  if (hovered.value === null) return {}
  const ratio = (bandX(hovered.value) + bandWidth.value / 2) / W
  // Flip the anchor near the right edge so the card never overflows the card.
  return ratio > 0.6
    ? { right: `${(1 - ratio) * 100}%`, top: '8px', marginRight: '8px' }
    : { left: `${ratio * 100}%`, top: '8px', marginLeft: '8px' }
})

// ── Formatting ────────────────────────────────────────────────────────────────

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
      : String(Math.round(n))

const formatAxis = (v: number) =>
  metric.value === 'cost'
    ? (v === 0 ? '0' : v < 1 ? `${v.toFixed(2)} $` : `${compact(v)} $`)
    : compact(v)

const cellText = (b: Bucket, key: string) => {
  const value = valueOf(b.values[key])
  if (!value) return '—'
  return metric.value === 'cost' ? formatCost(value) : formatTokens(value)
}

const totalText = (b: Bucket) =>
  metric.value === 'cost' ? formatCost(bucketTotal(b)) : formatTokens(bucketTotal(b))

const formatBucketDate = (date: string, short = false) => {
  const d = new Date(`${date}T00:00:00`)
  const text = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
  if (short) return text
  return granularity.value === 'week' ? `Semana del ${text}` : text
}
</script>
