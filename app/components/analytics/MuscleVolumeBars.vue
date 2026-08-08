<template>
  <UiCard
    eyebrow="Volumen"
    title="Series semanales por grupo muscular"
    hint="Media de las semanas con entrenamiento. El movimiento primario cuenta 1 serie; cada secundario, 0,5."
    flush
  >
    <template #actions>
      <UiTabs v-model="view" :tabs="VIEWS" />
    </template>

    <UiEmptyState
      v-if="!rows.length"
      title="Sin series clasificadas en el periodo"
      description="Sincroniza el catálogo de ejercicios desde Administración para poder atribuir las series."
    />

    <!-- ── Chart: every row is a graduated rule ──────────────────────────── -->
    <div v-else-if="view === 'chart'" class="p-5 space-y-5">
      <div v-for="row in rows" :key="row.muscle">
        <div class="flex items-baseline justify-between gap-3 mb-1.5">
          <span class="text-sm text-ink">{{ row.label }}</span>
          <span class="text-xs flex items-center gap-1.5" :class="row.style.text">
            <span aria-hidden="true">{{ row.style.glyph }}</span>
            <span class="font-data font-medium">{{ row.avg_sets }}</span>
            <span class="text-ink-3">series · {{ row.verdictLabel }}</span>
          </span>
        </div>

        <!-- Reading is positional: the bar's end lands before, between or past
             the MEV/MAV/MRV ticks, so the verdict survives without the colour. -->
        <UiTickScale
          :value="row.avg_sets"
          :max="scaleMax"
          :step="2"
          :landmarks="row.marks"
          :verdict="row.verdict"
          :show-readout="false"
          :aria-label="`${row.label}: ${row.avg_sets} series por semana, ${row.verdictLabel}`"
        />
      </div>

      <!-- Three states, each with its glyph, so identity never rests on hue. -->
      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 pt-4 border-t border-line text-xs text-ink-3">
        <span v-for="s in legend" :key="s.key" class="flex items-center gap-1.5">
          <span class="w-3 h-3 rounded-sm inline-block" :class="s.swatch" />
          <span aria-hidden="true">{{ s.glyph }}</span>
          {{ s.label }}
        </span>
        <span class="flex items-center gap-1.5">
          <span class="w-px h-3 bg-tick inline-block" />
          Límites MEV / MAV / MRV
        </span>
      </div>
    </div>

    <!-- ── Table view: every value reachable without hovering ───────────── -->
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-2 text-[11px] text-ink-3 uppercase tracking-wide">
          <tr>
            <th class="px-4 py-2.5 text-left font-semibold">Grupo</th>
            <th class="px-4 py-2.5 text-right font-semibold">Series/sem</th>
            <th class="px-4 py-2.5 text-right font-semibold">MEV</th>
            <th class="px-4 py-2.5 text-right font-semibold">MAV</th>
            <th class="px-4 py-2.5 text-right font-semibold">MRV</th>
            <th class="px-4 py-2.5 text-left font-semibold">Estado</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="row in rows" :key="row.muscle" class="hover:bg-surface-2 transition">
            <td class="px-4 py-2.5 text-ink-2">{{ row.label }}</td>
            <td class="px-4 py-2.5 text-right font-data font-medium text-ink">{{ row.avg_sets }}</td>
            <td class="px-4 py-2.5 text-right font-data text-ink-3">{{ row.landmarks?.mev ?? NO_VALUE }}</td>
            <td class="px-4 py-2.5 text-right font-data text-ink-3">{{ row.landmarks?.mav ?? NO_VALUE }}</td>
            <td class="px-4 py-2.5 text-right font-data text-ink-3">{{ row.landmarks?.mrv ?? NO_VALUE }}</td>
            <td class="px-4 py-2.5 whitespace-nowrap" :class="row.style.text">
              <span aria-hidden="true">{{ row.style.glyph }}</span> {{ row.verdictLabel }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UiCard>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface Average {
  muscle: string
  label: string
  avg_sets: number
  verdict: string
  landmarks: { mev: number; mav: number; mrv: number } | null
}

const props = defineProps<{ averages: Average[] }>()

const VIEWS = [
  { value: 'chart', label: 'Gráfico' },
  { value: 'table', label: 'Tabla' }
] as const

const view = ref<string>('chart')

/**
 * Three states, not four. The palette's `warning` and `serious` steps sit too
 * close under normal vision to ask a reader to tell "developmental" from
 * "optimal" by hue — both are healthy, and the number plus the position against
 * the ticks carry the finer reading.
 *
 * The hexes these used to hold are gone: the fill, the swatch and the text all
 * resolve from the same verdict token now, so the bar and the label can no
 * longer disagree, and both follow the theme.
 *
 * Positive and danger still sit close together under deuteranopia, which is why
 * every row also carries a glyph, a written verdict, and a readable position
 * against the MEV/MAV/MRV ticks.
 */
const STATES = {
  below: { verdict: 'warn' as const, label: 'Por debajo del mínimo', swatch: 'bg-warn' },
  in:    { verdict: 'positive' as const, label: 'En rango', swatch: 'bg-positive' },
  above: { verdict: 'danger' as const, label: 'Por encima del máximo', swatch: 'bg-danger' }
}

const legend = [
  { key: 'below', ...STATES.below, glyph: VERDICT_STYLES.warn.glyph },
  { key: 'in', ...STATES.in, glyph: VERDICT_STYLES.positive.glyph },
  { key: 'above', ...STATES.above, glyph: VERDICT_STYLES.danger.glyph }
]

const stateFor = (verdict: string) =>
  verdict === 'below_mev' ? STATES.below : verdict === 'above_mrv' ? STATES.above : STATES.in

const rows = computed(() =>
  props.averages.map(a => {
    const s = stateFor(a.verdict)
    return {
      ...a,
      verdict: s.verdict,
      verdictLabel: s.label,
      style: verdictStyle(s.verdict),
      marks: a.landmarks
        ? [
            { value: a.landmarks.mev, label: 'MEV (mínimo efectivo)', short: 'MEV' },
            { value: a.landmarks.mav, label: 'MAV (volumen adaptativo)', short: 'MAV' },
            { value: a.landmarks.mrv, label: 'MRV (máximo recuperable)', short: 'MRV' }
          ]
        : []
    }
  })
)

/**
 * The scale tops out above the largest MRV in view so an over-MRV bar still has
 * room to show how far past it went, rather than pinning to the end.
 */
const scaleMax = computed(() => {
  const values = props.averages.flatMap(a => [a.avg_sets, a.landmarks?.mrv ?? 0])
  return Math.max(10, Math.ceil(Math.max(...values, 0) * 1.1))
})
</script>
