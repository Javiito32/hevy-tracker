<template>
  <UiCard eyebrow="Composición" title="Evolución del peso" flush>
    <template #actions>
      <span v-if="weighted.length" class="font-data text-xs text-ink-3">{{ weighted.length }} registros</span>
    </template>

    <div v-if="pending" class="flex items-center justify-center h-48 text-ink-3">
      <UiSpinner />
    </div>

    <UiEmptyState
      v-else-if="!weighted.length"
      title="Sin datos de peso"
      description="Registra tu peso en Hevy y sincroniza para verlo aquí."
    />

    <div v-else class="p-4">
      <!-- Min, max and net change read as a row of measurements, so they are set
           in the data face. The net change carries no verdict colour: whether
           gaining is good depends on the block, which this component cannot know. -->
      <div class="flex justify-between font-data text-xs text-ink-3 mb-4 px-1">
        <span>Mín <span class="text-ink-2">{{ minWeight }} kg</span></span>
        <span>Δ <span class="text-ink">{{ totalChange >= 0 ? '+' : '' }}{{ totalChange }} kg</span></span>
        <span>Máx <span class="text-ink-2">{{ maxWeight }} kg</span></span>
      </div>

      <ChartsLineChart
        :points="chartPoints"
        :show-trend="true"
        :show-area="true"
        :format-y="(v) => `${v.toFixed(1)}`"
        :H="200"
      />

      <div class="flex items-center gap-4 mt-3 text-[11px] text-ink-3 px-1">
        <span class="flex items-center gap-1.5">
          <span class="w-4 h-0.5 bg-ink inline-block rounded" /> Peso registrado
        </span>
        <span class="flex items-center gap-1.5">
          <span class="w-4 border-t border-dashed border-ink-3 inline-block" /> Tendencia
        </span>
      </div>
    </div>
  </UiCard>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const { data: metrics, pending } = useFetch('/api/metrics')

const weighted = computed(() =>
  ((metrics.value ?? []) as { date: string; weight: number | null }[])
    .filter((m): m is { date: string; weight: number } => m.weight != null)
)

const chartPoints = computed(() =>
  weighted.value.map(m => ({ date: m.date, value: m.weight }))
)

const minWeight = computed(() => {
  if (!weighted.value.length) return 0
  return Math.min(...weighted.value.map(m => m.weight)).toFixed(1)
})

const maxWeight = computed(() => {
  if (!weighted.value.length) return 0
  return Math.max(...weighted.value.map(m => m.weight)).toFixed(1)
})

const totalChange = computed(() => {
  if (weighted.value.length < 2) return 0
  const arr = weighted.value
  return Number((arr[arr.length - 1].weight - arr[0].weight).toFixed(1))
})
</script>
