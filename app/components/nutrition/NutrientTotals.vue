<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden">
    <div class="px-5 py-3.5 border-b border-line flex items-center justify-between gap-3 flex-wrap">
      <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Totales diarios</h2>
      <div v-if="hasDaySplit" class="flex gap-1">
        <button
          v-for="key in DAY_KEYS"
          :key="key"
          @click="dayType = key"
          class="px-2.5 py-1 text-xs rounded-lg transition"
          :class="dayType === key
            ? 'bg-accent text-accent-ink'
            : 'bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2'"
        >
          {{ DAY_TABS[key] }}
        </button>
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
          <div v-if="targets?.kcal" class="text-xs mt-1" :class="kcalDeltaClass">
            Objetivo {{ formatNutrientValue(targets.kcal, 'kcal') }} kcal
            <span v-if="kcalDelta !== null">({{ kcalDelta > 0 ? '+' : '' }}{{ kcalDelta }})</span>
          </div>
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
        <p class="text-xs font-medium text-ink-3 uppercase tracking-wider mb-3">Micronutrientes</p>
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

const props = defineProps<{
  totals: any
  targets?: any | null
  macroSplit?: any | null
  proteinPerKg?: number | null
  hasDaySplit?: boolean
}>()

const DAY_KEYS = ['all', 'training', 'rest'] as const
const DAY_TABS: Record<string, string> = { all: 'Base', training: 'Entreno', rest: 'Descanso' }
const MACRO_BARS = ['protein_g', 'carbs_g', 'fat_g'] as const

const dayType = ref<'all' | 'training' | 'rest'>('all')

const current = computed(() => props.totals?.[dayType.value] ?? props.totals?.all ?? {})

const unknownCount = computed(() => MICRO_KEYS.filter(k => current.value[k] == null).length)

/**
 * A figure backed by only some of the foods is a lower bound, not the total.
 * It is shown with a `≥` rather than hidden — hiding it would blank out most
 * micronutrients, since food databases rarely carry them for every product.
 */
const partialFor = (key: string) => {
  const entry = props.totals?.coverage?.[dayType.value]?.[key]
  return entry && entry.known > 0 && entry.known < entry.total ? entry : null
}

const partialCount = computed(() => MICRO_KEYS.filter(k => partialFor(k)).length)

const targetFor = (key: string) =>
  ({ protein_g: props.targets?.protein_g, carbs_g: props.targets?.carbs_g, fat_g: props.targets?.fat_g } as any)[key] ?? null

const splitPct = (key: string) =>
  ({ protein_g: props.macroSplit?.protein_pct, carbs_g: props.macroSplit?.carbs_pct, fat_g: props.macroSplit?.fat_pct } as any)[key] ?? null

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
  if (!props.targets?.kcal || current.value.kcal == null) return null
  return Math.round(current.value.kcal - props.targets.kcal)
})

const kcalDeltaClass = computed(() => {
  if (kcalDelta.value === null) return 'text-ink-3'
  return Math.abs(kcalDelta.value) <= 50 ? 'text-positive' : 'text-warn'
})
</script>
