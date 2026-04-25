<template>
  <div>
    <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
      <h2 class="text-lg font-semibold text-slate-200">Evolución del peso</h2>
      <span v-if="metrics?.length" class="text-xs text-slate-500">{{ metrics.length }} registros</span>
    </div>

    <div class="p-4">
      <div v-if="pending" class="flex items-center justify-center h-48">
        <div class="animate-spin w-6 h-6 rounded-full border-4 border-indigo-500 border-t-transparent"></div>
      </div>

      <div v-else-if="!metrics?.length" class="flex items-center justify-center h-48 flex-col text-slate-500">
        <svg class="w-12 h-12 mb-2 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/>
        </svg>
        <p class="text-sm">Sin datos de peso</p>
      </div>

      <template v-else>
        <!-- Summary row -->
        <div class="flex justify-between text-xs text-slate-400 mb-3 px-1">
          <span>Mín: <strong>{{ minWeight }}kg</strong></span>
          <span :class="totalChange >= 0 ? 'text-rose-400' : 'text-emerald-400'">
            Total: {{ totalChange >= 0 ? '+' : '' }}{{ totalChange }}kg
          </span>
          <span>Máx: <strong>{{ maxWeight }}kg</strong></span>
        </div>

        <ChartsLineChart
          :points="chartPoints"
          color="#10b981"
          trend-color="#6366f1"
          :show-trend="true"
          :show-area="true"
          :format-y="(v) => `${v.toFixed(1)}kg`"
          :H="200"
        />

        <!-- Trend legend -->
        <div class="flex items-center gap-4 mt-3 text-xs text-slate-500 px-1">
          <span class="flex items-center gap-1.5">
            <span class="w-4 h-0.5 bg-emerald-500 inline-block rounded"></span> Peso real
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-4 border-t border-dashed border-indigo-500 inline-block"></span> Tendencia
          </span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const { data: metrics, pending } = useFetch('/api/metrics')

const chartPoints = computed(() => {
  if (!metrics.value) return []
  return (metrics.value as { date: string; weight: number }[]).map(m => ({
    date: m.date,
    value: m.weight
  }))
})

const minWeight = computed(() => {
  if (!metrics.value?.length) return 0
  return Math.min(...(metrics.value as any[]).map(m => m.weight)).toFixed(1)
})

const maxWeight = computed(() => {
  if (!metrics.value?.length) return 0
  return Math.max(...(metrics.value as any[]).map(m => m.weight)).toFixed(1)
})

const totalChange = computed(() => {
  if (!metrics.value || (metrics.value as any[]).length < 2) return 0
  const arr = metrics.value as any[]
  return Number((arr[arr.length - 1].weight - arr[0].weight).toFixed(1))
})
</script>
