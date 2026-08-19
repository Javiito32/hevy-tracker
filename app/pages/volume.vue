<template>
  <div class="max-w-6xl mx-auto">
    <UiPageHeader
      eyebrow="Análisis"
      title="Volumen por grupo muscular"
      subtitle="Series efectivas semanales frente a los rangos de referencia. El calentamiento no cuenta."
    >
      <template #actions>
        <div class="flex items-center gap-3">
          <UiLink :to="{ path: '/chat', query: { context: 'volume' } }" class="text-xs hidden sm:inline">Preguntar al coach</UiLink>
          <UiTabs v-model="weeksTab" :tabs="WEEK_TABS" />
        </div>
      </template>
    </UiPageHeader>

    <p v-if="error" class="text-sm text-danger flex items-start gap-2 bg-danger/5 border border-danger/30 rounded-lg px-4 py-3">
      <span aria-hidden="true">⚠</span>No se pudo calcular el volumen por grupo muscular. Reintenta en unos segundos.
    </p>

    <div v-else-if="pending" class="flex justify-center py-16 text-ink-3">
      <UiSpinner size="lg" />
    </div>

    <div v-else-if="data" class="space-y-4">
      <!-- Coverage is stated before any number is read: with exercises the
           catalogue can't classify, a low figure is a data gap, not a training
           gap, and the difference changes what the athlete should do. -->
      <div
        v-if="coveragePct < 100"
        class="rounded-card px-5 py-4 border bg-surface"
        :class="coveragePct < 80 ? 'border-warn/40' : 'border-line'"
      >
        <p class="text-sm flex items-start gap-2" :class="coveragePct < 80 ? 'text-warn' : 'text-ink-2'">
          <span v-if="coveragePct < 80" aria-hidden="true">△</span>
          <span><span class="font-data">{{ coveragePct }}%</span> de tus series están clasificadas por grupo muscular.</span>
        </p>
        <p class="text-xs mt-1.5 text-ink-3">
          {{ data.unclassified.length }} ejercicio(s) sin grupo asignado
          ({{ data.unclassified.slice(0, 3).map(u => u.name).join(', ') }}<span v-if="data.unclassified.length > 3">…</span>).
          Sus series no cuentan en ningún grupo, así que las cifras de abajo son un mínimo.
        </p>
      </div>

      <AnalyticsMuscleVolumeBars :averages="data.averages" />

      <AnalyticsMuscleHeatmap :weeks="data.weeks" />

      <p class="text-xs text-ink-3 leading-relaxed pt-2">
        <strong class="font-data font-medium text-ink-2">MEV</strong> mínimo efectivo ·
        <strong class="font-data font-medium text-ink-2">MAV</strong> volumen adaptativo ·
        <strong class="font-data font-medium text-ink-2">MRV</strong> máximo recuperable.
        Son referencias poblacionales para leer tu volumen, no objetivos que cumplir:
        la tolerancia individual varía lo bastante como para que tu rango real difiera.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const WEEK_TABS = [
  { value: '4', label: '4 sem' },
  { value: '8', label: '8 sem' },
  { value: '12', label: '12 sem' },
  { value: '26', label: '26 sem' }
] as const

const weeksTab = ref('8')
const weeks = computed(() => Number(weeksTab.value))

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
