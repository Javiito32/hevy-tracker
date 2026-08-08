<template>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
    <!-- Month-to-date is deliberately NOT scoped to the selected range: "what
         will this month cost" is a fixed question. -->
    <div class="bg-surface rounded-card border border-line border-t-4 border-t-violet-500 p-5">
      <p class="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">Gasto del mes en curso</p>
      <p class="font-data text-2xl text-ink">{{ formatCost(mtd?.cost) }}</p>
      <p class="text-xs text-ink-3 mt-1">
        {{ mtd ? `día ${mtd.days_elapsed} de ${mtd.days_in_month}` : '—' }} ·
        {{ formatTokens(mtd?.tokens) }} tokens
      </p>
    </div>

    <div class="bg-surface rounded-card border border-line border-t-4 border-t-amber-500 p-5">
      <p class="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">Proyección a fin de mes</p>
      <p class="font-data text-2xl text-ink">{{ formatCost(mtd?.projected_cost) }}</p>
      <p class="text-xs text-ink-3 mt-1">
        Media diaria actual · {{ formatCost(dailyAverage) }}/día
      </p>
    </div>

    <div class="bg-surface rounded-card border border-line border-t-4 border-t-indigo-500 p-5">
      <p class="text-xs font-semibold text-ink-3 uppercase tracking-wider mb-2">Coste medio por interacción</p>
      <p class="font-data text-2xl text-ink">{{ formatCost(avgPerInteraction) }}</p>
      <p class="text-xs text-ink-3 mt-1">
        {{ costableCount === null ? '—' : `sobre ${formatTokens(costableCount)} interacciones con coste` }}
        <span v-if="excludedCount > 0" class="text-warn/80">· {{ excludedCount }} sin coste</span>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Run-rate stat tiles. Values, not charts: each is a single number, which a
 * one-bar chart would only dilute.
 */
interface MonthToDate {
  cost: number
  tokens: number
  interactions: number
  days_elapsed: number
  days_in_month: number
  projected_cost: number
}

interface Totals {
  interactions: number
  cost: number
  unpriced_count: number
  no_breakdown_count: number
}

const props = defineProps<{ mtd?: MonthToDate; totals?: Totals }>()

const dailyAverage = computed(() =>
  props.mtd && props.mtd.days_elapsed > 0 ? props.mtd.cost / props.mtd.days_elapsed : null
)

/** Rows excluded from cost: unpriced model, or predating the in/out split. */
const excludedCount = computed(() =>
  (props.totals?.unpriced_count ?? 0) + (props.totals?.no_breakdown_count ?? 0)
)

const costableCount = computed(() => {
  if (!props.totals) return null
  return Math.max(0, props.totals.interactions - excludedCount.value)
})

/**
 * Divides by the costable interactions only. Using the full count would fold
 * the uncostable rows in as if they were free and understate the average.
 */
const avgPerInteraction = computed(() => {
  if (!props.totals || !costableCount.value) return null
  return props.totals.cost / costableCount.value
})
</script>
