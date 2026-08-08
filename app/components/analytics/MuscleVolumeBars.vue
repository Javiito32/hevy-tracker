<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
    <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h2 class="text-base font-semibold text-slate-200">Series semanales por grupo muscular</h2>
        <p class="text-xs text-slate-500 mt-1">
          Media de las semanas con entrenamiento. El movimiento primario cuenta 1 serie; cada secundario, 0,5.
        </p>
      </div>
      <button
        @click="showTable = !showTable"
        class="text-xs text-slate-400 border border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-800 transition"
      >
        {{ showTable ? 'Ver gráfico' : 'Ver tabla' }}
      </button>
    </div>

    <div v-if="!rows.length" class="p-10 text-center text-slate-500 text-sm">
      Sin series clasificadas en el periodo. Sincroniza el catálogo de ejercicios desde Administración.
    </div>

    <!-- ── Chart ────────────────────────────────────────────────────────── -->
    <div v-else-if="!showTable" class="p-6 space-y-3">
      <div v-for="row in rows" :key="row.muscle" class="group">
        <div class="flex items-baseline justify-between gap-3 mb-1">
          <span class="text-sm text-slate-300">{{ row.label }}</span>
          <span class="text-xs tabular-nums flex items-center gap-1.5" :class="row.textClass">
            <span aria-hidden="true">{{ row.glyph }}</span>
            <span class="font-medium">{{ row.avg_sets }}</span>
            <span class="text-slate-600">series · {{ row.verdictLabel }}</span>
          </span>
        </div>

        <!-- The track is the scale; band edges are ticks on it, so the reading
             is positional and does not depend on the bar's colour. -->
        <div class="relative h-5 bg-slate-950 rounded" :style="{ '--scale': String(scaleMax) }">
          <template v-if="row.landmarks">
            <div
              v-for="mark in bandMarks(row)"
              :key="mark.key"
              class="absolute top-0 bottom-0 w-px"
              :class="mark.class"
              :style="{ left: pct(mark.value) }"
              :title="`${mark.label}: ${mark.value} series`"
            ></div>
          </template>

          <div
            class="absolute top-1 bottom-1 left-0 rounded-r-[4px] transition-all"
            :style="{ width: pct(row.avg_sets), background: row.color }"
          ></div>

          <span
            v-if="row.landmarks"
            class="absolute -top-0.5 text-[9px] text-slate-600 font-mono pointer-events-none hidden sm:block"
            :style="{ left: `calc(${pct(row.landmarks.mev)} + 3px)` }"
          >MEV</span>
          <span
            v-if="row.landmarks"
            class="absolute -top-0.5 text-[9px] text-slate-600 font-mono pointer-events-none hidden sm:block"
            :style="{ left: `calc(${pct(row.landmarks.mrv)} + 3px)` }"
          >MRV</span>
        </div>
      </div>

      <!-- Legend: three states, each with its glyph, so identity never rests on hue. -->
      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 pt-4 mt-2 border-t border-slate-800 text-xs text-slate-500">
        <span v-for="s in legend" :key="s.key" class="flex items-center gap-1.5">
          <span class="w-3 h-3 rounded-sm inline-block" :style="{ background: s.color }"></span>
          <span aria-hidden="true">{{ s.glyph }}</span>
          {{ s.label }}
        </span>
        <span class="flex items-center gap-1.5">
          <span class="w-px h-3 bg-slate-600 inline-block"></span>
          Límites MEV / MRV
        </span>
      </div>
    </div>

    <!-- ── Table view: every value reachable without hovering ───────────── -->
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-800 text-xs text-slate-500 uppercase tracking-wider">
          <tr>
            <th class="px-4 py-2 text-left">Grupo</th>
            <th class="px-4 py-2 text-right">Series/sem</th>
            <th class="px-4 py-2 text-right">MEV</th>
            <th class="px-4 py-2 text-right">MAV</th>
            <th class="px-4 py-2 text-right">MRV</th>
            <th class="px-4 py-2 text-left">Estado</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800">
          <tr v-for="row in rows" :key="row.muscle" class="hover:bg-slate-800/50 transition">
            <td class="px-4 py-2 text-slate-300">{{ row.label }}</td>
            <td class="px-4 py-2 text-right tabular-nums font-medium text-slate-200">{{ row.avg_sets }}</td>
            <td class="px-4 py-2 text-right tabular-nums text-slate-500">{{ row.landmarks?.mev ?? NO_VALUE }}</td>
            <td class="px-4 py-2 text-right tabular-nums text-slate-500">{{ row.landmarks?.mav ?? NO_VALUE }}</td>
            <td class="px-4 py-2 text-right tabular-nums text-slate-500">{{ row.landmarks?.mrv ?? NO_VALUE }}</td>
            <td class="px-4 py-2" :class="row.textClass">{{ row.glyph }} {{ row.verdictLabel }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
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

const showTable = ref(false)

/**
 * Three states, not four. The palette's `warning` and `serious` steps measure
 * ΔE 13.6 apart under normal vision — below the 15 floor — so splitting
 * "developmental" from "optimal" by hue would ask readers to distinguish two
 * colours they cannot reliably tell apart. Both are healthy; the number and the
 * band ticks carry the finer reading.
 *
 * Green vs red sit at ΔE 4.1 under deuteranopia, which is why every row also
 * carries a glyph, a written verdict, and a position against the MEV/MRV ticks.
 */
const STATES = {
  below: { color: '#fab219', glyph: '↓', label: 'Por debajo del mínimo', text: 'text-amber-400' },
  in:    { color: '#0ca30c', glyph: '✓', label: 'En rango',              text: 'text-emerald-400' },
  above: { color: '#d03b3b', glyph: '↑', label: 'Por encima del máximo', text: 'text-rose-400' }
} as const

const legend = [
  { key: 'below', ...STATES.below },
  { key: 'in', ...STATES.in },
  { key: 'above', ...STATES.above }
]

const stateFor = (verdict: string) =>
  verdict === 'below_mev' ? STATES.below : verdict === 'above_mrv' ? STATES.above : STATES.in

const rows = computed(() =>
  props.averages.map(a => {
    const s = stateFor(a.verdict)
    return {
      ...a,
      color: s.color,
      glyph: s.glyph,
      verdictLabel: s.label,
      textClass: s.text
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

const pct = (v: number) => `${Math.min(100, (v / scaleMax.value) * 100)}%`

const bandMarks = (row: Average) => row.landmarks ? [
  { key: 'mev', value: row.landmarks.mev, label: 'MEV (mínimo efectivo)', class: 'bg-slate-600' },
  { key: 'mav', value: row.landmarks.mav, label: 'MAV (volumen adaptativo)', class: 'bg-slate-700' },
  { key: 'mrv', value: row.landmarks.mrv, label: 'MRV (máximo recuperable)', class: 'bg-slate-600' }
] : []
</script>
