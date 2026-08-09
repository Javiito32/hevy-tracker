<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden">
    <div class="px-5 py-3.5 border-b border-line flex items-center justify-between gap-3 flex-wrap">
      <h2 class="font-display text-sm font-semibold tracking-tight text-ink">
        {{ mode === 'day' ? WEEKDAY_LABELS[weekday] : 'Media semanal' }}
      </h2>
      <!-- Day vs week, NOT a day picker: the day comes from the page, so this
           card and the meal list below it can never disagree again. -->
      <div class="flex gap-1">
        <button
          v-for="option in MODES"
          :key="option.value"
          type="button"
          @click="mode = option.value"
          class="px-2.5 py-1 text-xs rounded-lg transition"
          :class="mode === option.value
            ? 'bg-accent text-accent-ink'
            : 'bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2'"
        >{{ option.label }}</button>
      </div>
    </div>

    <div class="p-6 space-y-6">
      <!-- Energía -->
      <div class="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div class="text-4xl font-bold text-ink">
            {{ formatNutrientValue(current.kcal, 'kcal') }}
            <span class="text-base font-normal text-ink-3 ml-1">kcal</span>
          </div>

          <!-- An empty day reads as "—", never as 0, and never against a target:
               a −2400 kcal deficit against nothing planned is not a finding. -->
          <p v-if="mode === 'day' && !isPlanned" class="text-xs text-ink-3 mt-1">
            Este día no tiene comidas. No cuenta para la media semanal.
          </p>
          <div v-else-if="activeTarget?.kcal" class="text-xs mt-1" :class="kcalDeltaClass">
            Objetivo {{ formatNutrientValue(activeTarget.kcal, 'kcal') }} kcal
            <span v-if="kcalDelta !== null">({{ kcalDelta > 0 ? '+' : '' }}{{ kcalDelta }})</span>
            <span v-if="mode === 'day' && dayTarget?.overridden" class="text-ink-3"> · propio de este día</span>
          </div>

          <!-- The mean never appears without its denominator. -->
          <p v-if="mode === 'week'" class="text-xs text-ink-3 mt-1">
            <template v-if="plannedDays.length">
              Media de {{ plannedDays.length }} {{ plannedDays.length === 1 ? 'día' : 'días' }} con comidas
              ({{ formatWeekdayList(plannedDays) }}).
            </template>
            <template v-else>Ningún día tiene comidas todavía.</template>
          </p>
        </div>
        <div v-if="proteinPerKg != null" class="text-right">
          <div class="font-display text-sm font-semibold tracking-tight text-ink">{{ proteinPerKg.toLocaleString('es-ES', { maximumFractionDigits: 2 }) }}</div>
          <div class="text-xs text-ink-3">g proteína / kg</div>
        </div>
      </div>

      <!-- Macros -->
      <div class="space-y-3">
        <div v-for="key in MACRO_BARS" :key="key">
          <div class="flex items-center justify-between text-sm mb-1">
            <span class="text-ink-2">
              {{ NUTRIENT_LABELS[key] }}
              <span v-if="splitPct(key) !== null" class="text-ink-3 text-xs ml-1">{{ splitPct(key) }}%</span>
            </span>
            <span class="text-ink-2">
              {{ formatNutrient(current[key], key) }}
              <span v-if="targetFor(key)" class="text-ink-3 text-xs"> / {{ formatNutrient(targetFor(key), key) }}</span>
            </span>
          </div>
          <div class="h-2 rounded-full bg-surface-2 overflow-hidden">
            <div class="h-full rounded-full transition-all" :class="MACRO_COLORS[key]" :style="{ width: barWidth(key) }"></div>
          </div>
        </div>
      </div>

      <!-- Micronutrientes -->
      <div>
        <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-3">Micronutrientes</p>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
          <div v-for="key in MICRO_KEYS" :key="key" class="flex items-baseline justify-between gap-2 text-sm">
            <span class="text-ink-3 text-xs truncate">{{ NUTRIENT_SHORT_LABELS[key] }}</span>
            <span :class="current[key] == null ? 'text-ink-3' : 'text-ink-2'">
              <span
                v-if="partialFor(key)"
                class="text-warn text-xs mr-0.5"
                :title="`Mínimo: solo ${partialFor(key).known} de ${partialFor(key).total} alimentos tienen este dato.`"
              >≥</span>{{ formatNutrient(current[key], key) }}
            </span>
          </div>
        </div>
        <p v-if="unknownCount || partialCount" class="text-xs text-ink-3 mt-3">
          <template v-if="partialCount">
            <span class="text-warn">≥</span> marca cifras calculadas solo con los alimentos que tienen ese dato:
            son mínimos, el valor real es mayor.
          </template>
          <template v-if="unknownCount">
            {{ partialCount ? ' ' : '' }}<span class="text-ink-3">—</span> significa que ningún alimento de la dieta
            tiene ese dato, no que la ingesta sea cero.
          </template>
          Puedes completarlos editando los alimentos en el catálogo.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

/**
 * Totals for the selected weekday, or the mean of the planned days.
 *
 * The selected day is a prop, not local state. Its predecessor owned its own
 * day switcher, which changed the figures in this card but not the meal list
 * underneath — two controls for one question, disagreeing.
 */
const props = defineProps<{
  /** `days` from serializeVersion: per-weekday totals, coverage, split, target. */
  days: Array<any>
  /** The weekday the page is showing. */
  weekday: number
  average: any
  averageCoverage?: any
  averageMacroSplit?: any | null
  averageProteinPerKg?: number | null
  plannedDays: number[]
  /** The version's base targets; a day may override them. */
  targets?: any | null
}>()

const MODES = [
  { value: 'day' as const, label: 'Día' },
  { value: 'week' as const, label: 'Media semanal' }
]
const MACRO_BARS = ['protein_g', 'carbs_g', 'fat_g'] as const

const mode = ref<'day' | 'week'>('day')

const day = computed(() => props.days?.find((d: any) => d.weekday === props.weekday) ?? null)
const isPlanned = computed(() => !!day.value?.planned)
const dayTarget = computed(() => day.value?.target ?? null)

const current = computed(() =>
  (mode.value === 'day' ? day.value?.totals : props.average) ?? {}
)

const coverage = computed(() =>
  (mode.value === 'day' ? day.value?.coverage : props.averageCoverage) ?? {}
)

/** A day with no food has no target to miss — see the template. */
const activeTarget = computed(() => {
  if (mode.value === 'week') return props.targets ?? null
  return isPlanned.value ? dayTarget.value : null
})

const macroSplit = computed(() =>
  (mode.value === 'day' ? day.value?.macro_split : props.averageMacroSplit) ?? null
)

const proteinPerKg = computed(() =>
  (mode.value === 'day' ? day.value?.protein_g_per_kg : props.averageProteinPerKg) ?? null
)

const unknownCount = computed(() => MICRO_KEYS.filter(k => current.value[k] == null).length)

/**
 * A figure backed by only some of the foods is a lower bound, not the total.
 * It is shown with a `≥` rather than hidden — hiding it would blank out most
 * micronutrients, since food databases rarely carry them for every product.
 */
const partialFor = (key: string) => {
  const entry = coverage.value?.[key]
  return entry && entry.known > 0 && entry.known < entry.total ? entry : null
}

const partialCount = computed(() => MICRO_KEYS.filter(k => partialFor(k)).length)

const targetFor = (key: string) =>
  ({
    protein_g: activeTarget.value?.protein_g,
    carbs_g: activeTarget.value?.carbs_g,
    fat_g: activeTarget.value?.fat_g
  } as any)[key] ?? null

const splitPct = (key: string) =>
  ({
    protein_g: macroSplit.value?.protein_pct,
    carbs_g: macroSplit.value?.carbs_pct,
    fat_g: macroSplit.value?.fat_pct
  } as any)[key] ?? null

/**
 * Bars fill against the target when one is set, and against the largest macro
 * otherwise — a bar with no reference point would just be decoration.
 */
const barWidth = (key: string) => {
  const value = current.value[key]
  if (value == null) return '0%'
  const target = targetFor(key)
  const reference = target || Math.max(...MACRO_BARS.map(k => current.value[k] ?? 0), 1)
  return `${Math.min((value / reference) * 100, 100)}%`
}

const kcalDelta = computed(() => {
  if (!activeTarget.value?.kcal || current.value.kcal == null) return null
  return Math.round(current.value.kcal - activeTarget.value.kcal)
})

const kcalDeltaClass = computed(() => {
  if (kcalDelta.value === null) return 'text-ink-3'
  return Math.abs(kcalDelta.value) <= 50 ? 'text-positive' : 'text-warn'
})
</script>
