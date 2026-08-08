<template>
  <UiCard
    eyebrow="Volumen"
    title="Reparto semana a semana"
    hint="Series por grupo muscular en cada semana del periodo."
    flush
  >
    <template #actions>
      <UiTabs v-model="view" :tabs="VIEWS" />
    </template>

    <UiEmptyState v-if="!muscles.length" title="Sin datos en el periodo" />

    <div v-else class="overflow-x-auto">
      <table class="text-sm border-separate" style="border-spacing: 2px" :class="view === 'table' ? 'w-full' : ''">
        <thead>
          <tr>
            <th class="sticky left-0 bg-surface z-10 px-3 py-2 text-left text-[11px] font-medium text-ink-3 uppercase tracking-wide">
              Grupo
            </th>
            <th
              v-for="w in weeks"
              :key="w.week"
              class="px-1 py-2 font-data text-[10px] font-normal text-ink-3 whitespace-nowrap"
              :title="`Semana del ${formatDateShort(w.week)} · ${w.sessions} ${w.sessions === 1 ? 'sesión' : 'sesiones'}`"
            >
              {{ shortWeek(w.week) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in muscles" :key="m">
            <th class="sticky left-0 bg-surface z-10 px-3 py-1 text-left text-xs font-normal text-ink-2 whitespace-nowrap">
              {{ labelFor(m) }}
            </th>
            <td v-for="w in weeks" :key="w.week + m" class="p-0">
              <!-- A zero week is left as the bare surface with a hairline, not
                   painted the faintest step: "no training" and "a little
                   training" must not look like neighbours on the same ramp. -->
              <div
                class="w-7 h-6 rounded-sm flex items-center justify-center font-data text-[10px] transition"
                :class="cellValue(w, m) > 0 ? stepFor(cellValue(w, m)).text : 'border border-line'"
                :style="cellValue(w, m) > 0 ? { background: stepFor(cellValue(w, m)).bg } : {}"
                :title="`${labelFor(m)} · semana del ${formatDateShort(w.week)}: ${cellValue(w, m)} series`"
              >
                <span v-if="view === 'table'">{{ cellValue(w, m) || '' }}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template v-if="muscles.length" #footer>
      <div class="flex items-center gap-3">
        <span>Menos</span>
        <div class="flex gap-0.5">
          <span
            v-for="(a, i) in RAMP"
            :key="i"
            class="w-5 h-3 rounded-sm inline-block"
            :style="{ background: `rgb(var(--ink) / ${a})` }"
          />
        </div>
        <span>Más</span>
        <span class="ml-auto font-data">máx {{ maxSets }} series</span>
      </div>
    </template>
  </UiCard>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface Week {
  week: string
  sessions: number
  muscles: Array<{ muscle: string; label: string; sets: number }>
}

const props = defineProps<{ weeks: Week[] }>()

const VIEWS = [
  { value: 'map', label: 'Mapa' },
  { value: 'table', label: 'Tabla' }
] as const

const view = ref<string>('map')

/**
 * Sequential ramp as opacities of the ink token, not a fixed hue.
 *
 * The previous ramp was five blues validated against one surface (#0f172a) and
 * running dark→light, which is the wrong direction on chalk: the heaviest weeks
 * would have come out palest. Expressed as alpha over the card, the ramp is
 * monotone **by construction** in both themes — more sets is always more
 * contrast against the surface — and there is no second palette to keep
 * validated.
 *
 * It is also the right call for the thesis: this cell says "how much", not
 * "good or bad", and the colour budget is spent on verdicts.
 *
 * The lowest step stays at 0.14 so a light week still reads as painted rather
 * than empty; below that it becomes indistinguishable from a zero cell.
 */
const RAMP = [0.14, 0.32, 0.5, 0.7, 0.9]

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

/**
 * The label flips to the page ground on the top two steps, where the ink wash
 * is dense enough that ink-on-ink would disappear.
 */
const stepFor = (value: number) => {
  const idx = maxSets.value <= 0
    ? 0
    : Math.max(0, Math.min(RAMP.length - 1, Math.floor((value / maxSets.value) * RAMP.length)))
  return {
    bg: `rgb(var(--ink) / ${RAMP[idx]})`,
    text: idx >= 3 ? 'text-bg font-medium' : 'text-ink'
  }
}

const shortWeek = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
}
</script>
