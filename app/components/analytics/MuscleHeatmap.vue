<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
    <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h2 class="text-base font-semibold text-slate-200">Reparto semana a semana</h2>
        <p class="text-xs text-slate-500 mt-1">Series por grupo muscular en cada semana del periodo.</p>
      </div>
      <button
        @click="showTable = !showTable"
        class="text-xs text-slate-400 border border-slate-700 rounded-lg px-3 py-1.5 hover:bg-slate-800 transition"
      >
        {{ showTable ? 'Ver mapa' : 'Ver tabla' }}
      </button>
    </div>

    <div v-if="!muscles.length" class="p-10 text-center text-slate-500 text-sm">
      Sin datos en el periodo.
    </div>

    <div v-else class="overflow-x-auto">
      <table class="text-sm border-separate" style="border-spacing: 2px" :class="showTable ? 'w-full' : ''">
        <thead>
          <tr>
            <th class="sticky left-0 bg-slate-900 z-10 px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
              Grupo
            </th>
            <th
              v-for="w in weeks"
              :key="w.week"
              class="px-1 py-2 text-[10px] font-mono font-normal text-slate-600 whitespace-nowrap"
              :title="`Semana del ${formatDateShort(w.week)} · ${w.sessions} ${w.sessions === 1 ? 'sesión' : 'sesiones'}`"
            >
              {{ shortWeek(w.week) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in muscles" :key="m">
            <th class="sticky left-0 bg-slate-900 z-10 px-3 py-1 text-left text-xs font-normal text-slate-400 whitespace-nowrap">
              {{ labelFor(m) }}
            </th>
            <td
              v-for="w in weeks"
              :key="w.week + m"
              class="p-0"
            >
              <!-- A zero week is left as the bare surface with a hairline, not
                   painted the darkest step: "no training" and "a little
                   training" must not look like neighbours on the same ramp. -->
              <div
                class="w-7 h-6 rounded-sm flex items-center justify-center text-[10px] tabular-nums transition"
                :class="cellValue(w, m) > 0 ? 'text-slate-950 font-medium' : 'border border-slate-800'"
                :style="cellValue(w, m) > 0 ? { background: colorFor(cellValue(w, m)) } : {}"
                :title="`${labelFor(m)} · semana del ${formatDateShort(w.week)}: ${cellValue(w, m)} series`"
              >
                <span v-if="showTable">{{ cellValue(w, m) || '' }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="muscles.length" class="px-6 py-3 border-t border-slate-800 flex items-center gap-3 text-xs text-slate-500">
      <span>Menos</span>
      <div class="flex gap-0.5">
        <span
          v-for="(c, i) in RAMP"
          :key="i"
          class="w-5 h-3 rounded-sm inline-block"
          :style="{ background: c }"
        ></span>
      </div>
      <span>Más</span>
      <span class="ml-auto font-mono">máx {{ maxSets }} series</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface Week {
  week: string
  sessions: number
  muscles: Array<{ muscle: string; label: string; sets: number }>
}

const props = defineProps<{ weeks: Week[] }>()

const showTable = ref(false)

/**
 * Sequential single-hue ramp, validated against this app's surface (#0f172a):
 * lightness is monotone, every adjacent step clears ΔL 0.06, and the darkest
 * step holds 2.20:1 against the surface. The darker steps below it were
 * rejected — at 1.49:1 they are indistinguishable from an empty cell.
 * Re-run scripts/validate_palette.js from the dataviz skill before changing these.
 */
const RAMP = ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#9ec5f4']

const weeks = computed(() => props.weeks)

/** Rows ordered by total volume across the period, so the busiest muscles lead. */
const muscles = computed(() => {
  const totals = new Map<string, number>()
  for (const w of props.weeks) {
    for (const m of w.muscles) totals.set(m.muscle, (totals.get(m.muscle) ?? 0) + m.sets)
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m)
})

const labels = computed(() => {
  const map = new Map<string, string>()
  for (const w of props.weeks) for (const m of w.muscles) map.set(m.muscle, m.label)
  return map
})
const labelFor = (m: string) => labels.value.get(m) ?? m

const cellValue = (week: Week, muscle: string): number =>
  week.muscles.find(m => m.muscle === muscle)?.sets ?? 0

const maxSets = computed(() => {
  let max = 0
  for (const w of props.weeks) for (const m of w.muscles) if (m.sets > max) max = m.sets
  return Math.round(max * 10) / 10
})

const colorFor = (value: number): string => {
  if (maxSets.value <= 0) return RAMP[0]
  const idx = Math.min(RAMP.length - 1, Math.floor((value / maxSets.value) * RAMP.length))
  return RAMP[Math.max(0, idx)]
}

const shortWeek = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
}
</script>
