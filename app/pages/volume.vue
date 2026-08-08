<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <div class="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-3xl font-bold text-slate-100">Volumen por grupo muscular</h1>
        <p class="text-sm text-slate-500 mt-1">
          Series efectivas semanales frente a los rangos de referencia. El calentamiento no cuenta.
        </p>
      </div>

      <div class="flex gap-1.5">
        <button
          v-for="opt in WEEK_OPTIONS"
          :key="opt"
          @click="weeks = opt"
          class="text-xs px-3 py-1.5 rounded-full border transition"
          :class="weeks === opt
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'text-slate-400 border-slate-700 hover:bg-slate-800'"
        >
          {{ opt }} sem
        </button>
      </div>
    </div>

    <div v-if="error" class="bg-rose-950/60 border border-rose-800 text-rose-400 text-sm px-4 py-3 rounded-lg">
      No se pudo calcular el volumen por grupo muscular. Reintenta en unos segundos.
    </div>

    <div v-else-if="pending" class="flex justify-center py-16">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent"></div>
    </div>

    <template v-else-if="data">
      <!-- Coverage is stated before any number is read: with exercises the
           catalogue can't classify, a low figure is a data gap, not a training
           gap, and the difference changes what the athlete should do. -->
      <div
        v-if="coveragePct < 100"
        class="rounded-xl px-5 py-4 border"
        :class="coveragePct < 80
          ? 'bg-amber-950/30 border-amber-900/50'
          : 'bg-slate-900 border-slate-800'"
      >
        <p class="text-sm" :class="coveragePct < 80 ? 'text-amber-300' : 'text-slate-400'">
          {{ coveragePct }}% de tus series están clasificadas por grupo muscular.
        </p>
        <p class="text-xs mt-1" :class="coveragePct < 80 ? 'text-amber-500/80' : 'text-slate-500'">
          {{ data.unclassified.length }} ejercicio(s) sin grupo asignado
          ({{ data.unclassified.slice(0, 3).map(u => u.name).join(', ') }}<span v-if="data.unclassified.length > 3">…</span>).
          Sus series no cuentan en ningún grupo, así que las cifras de abajo son un mínimo.
        </p>
      </div>

      <AnalyticsMuscleVolumeBars :averages="data.averages" />

      <AnalyticsMuscleHeatmap :weeks="data.weeks" />

      <p class="text-xs text-slate-600 leading-relaxed">
        <strong class="text-slate-500">MEV</strong> mínimo efectivo ·
        <strong class="text-slate-500">MAV</strong> volumen adaptativo ·
        <strong class="text-slate-500">MRV</strong> máximo recuperable.
        Son referencias poblacionales para leer tu volumen, no objetivos que cumplir:
        la tolerancia individual varía lo bastante como para que tu rango real difiera.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const WEEK_OPTIONS = [4, 8, 12, 26]
const weeks = ref(8)

const { data, pending, error } = useFetch<{
  weeks: Array<{ week: string; sessions: number; muscles: Array<{ muscle: string; label: string; sets: number }> }>
  averages: Array<{ muscle: string; label: string; avg_sets: number; verdict: string; landmarks: any }>
  unclassified: Array<{ name: string; sets: number }>
  coverage: { classified_sets: number; total_sets: number }
}>('/api/analytics/muscle-volume', {
  query: computed(() => ({ weeks: weeks.value })),
  watch: [weeks]
})

const coveragePct = computed(() => {
  const c = data.value?.coverage
  if (!c || c.total_sets === 0) return 100
  return Math.round((c.classified_sets / c.total_sets) * 100)
})
</script>
