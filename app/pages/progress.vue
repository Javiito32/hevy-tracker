<template>
  <div class="max-w-6xl mx-auto">
    <UiPageHeader eyebrow="Análisis" title="Progresión por ejercicio" />

    <div v-if="exercisePending" class="flex justify-center py-16 text-ink-3">
      <UiSpinner size="lg" />
    </div>

    <div v-else class="flex flex-col lg:flex-row gap-4">
      <!-- Sidebar: exercise list -->
      <div class="lg:w-72 flex-shrink-0">
        <UiCard flush>
          <div class="p-3 border-b border-line">
            <UiInput v-model="search" placeholder="Buscar ejercicio…" aria-label="Buscar ejercicio" />
          </div>
          <div class="overflow-y-auto custom-scrollbar max-h-[calc(100vh-280px)]">
            <p v-if="filteredExercises.length === 0" class="p-5 text-ink-3 text-sm text-center">
              {{ search ? 'Ningún ejercicio coincide.' : 'Todavía no hay ejercicios sincronizados.' }}
            </p>
            <button
              v-for="ex in filteredExercises"
              :key="ex.name"
              class="w-full text-left px-4 py-3 border-b border-line hover:bg-surface-2 transition"
              :class="selectedExercise === ex.name && 'bg-surface-2'"
              :aria-pressed="selectedExercise === ex.name"
              @click="selectExercise(ex.name)"
            >
              <p class="text-sm font-medium text-ink">{{ ex.name }}</p>
              <div class="flex items-center justify-between mt-0.5">
                <span class="font-data text-xs text-ink-3">{{ ex.sessionCount }} sesiones</span>
                <!-- The best, not the latest: one bad session used to make a
                     lift look weaker than the athlete has ever been. -->
                <span v-if="ex.bestEstimated1rm" class="font-data text-xs text-ink-2">
                  1RM {{ ex.bestEstimated1rm.toFixed(1) }} kg
                </span>
              </div>
            </button>
          </div>
        </UiCard>
      </div>

      <!-- Main chart area -->
      <div class="flex-grow min-w-0">
        <UiCard v-if="!selectedExercise" flush>
          <UiEmptyState
            title="Elige un ejercicio"
            description="Su 1RM estimado, volumen y peso máximo sesión a sesión, con la tendencia."
          />
        </UiCard>

        <UiCard v-else-if="chartPending" flush>
          <div class="py-16 flex justify-center text-ink-3"><UiSpinner size="lg" /></div>
        </UiCard>

        <div v-else-if="chartData" class="space-y-4">
          <UiCard :eyebrow="`${chartData.points.length} sesiones`" :title="selectedExercise">
            <template #actions>
              <UiTabs v-model="activeTab" :tabs="METRIC_TABS" />
            </template>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-5 mb-6">
              <UiStat label="1RM actual" :value="latestPoint?.estimated_1rm ?? null" unit="kg" :decimals="1" />
              <UiStat label="Mejor 1RM" :value="bestE1rm" unit="kg" :decimals="1" />
              <!-- A rolling window, not first-ever vs latest: comparing today
                   against a session from two years ago says nothing about
                   whether the lift is moving now. -->
              <UiStat
                label="Últimos 30 días"
                :value="rollingProgress === null ? null : Math.abs(rollingProgress)"
                unit="kg"
                :decimals="1"
                :delta="rollingProgress"
                hint="vs. los 30 anteriores"
              />
              <UiStat label="Sesiones" :value="chartData.points.length" />
            </div>

            <ChartsLineChart
              v-if="activePoints.length"
              :points="activePoints"
              :color="tabColor"
              :format-y="tabFormatY"
              :H="220"
            />
            <p v-else class="text-center text-ink-3 py-8 text-sm">Sin datos para esta métrica.</p>
          </UiCard>

          <UiCard eyebrow="Registro" title="Historial de sesiones" flush>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-surface-2 text-[11px] text-ink-3 uppercase tracking-wide">
                  <tr>
                    <th class="px-4 py-2.5 text-left font-semibold">Fecha</th>
                    <th class="px-4 py-2.5 text-right font-semibold">1RM est.</th>
                    <th class="px-4 py-2.5 text-right font-semibold">Peso máx.</th>
                    <th class="px-4 py-2.5 text-right font-semibold">Volumen</th>
                    <th class="px-4 py-2.5 text-right font-semibold">Series</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-line">
                  <tr v-for="(pt, i) in [...chartData.points].reverse()" :key="i" class="hover:bg-surface-2 transition">
                    <td class="px-4 py-2.5 font-data text-ink-2 whitespace-nowrap">
                      {{ formatDate(pt.date) }}
                      <span
                        v-if="pt.records?.length"
                        class="ml-1.5 text-[10px] bg-warn/10 text-warn px-1.5 py-0.5 rounded"
                        :title="`Récord: ${pt.records.map(recordLabel).join(', ')}`"
                      >★ récord</span>
                    </td>
                    <td class="px-4 py-2.5 text-right font-data font-medium text-ink">{{ pt.estimated_1rm != null ? `${pt.estimated_1rm.toFixed(1)} kg` : NO_VALUE }}</td>
                    <td class="px-4 py-2.5 text-right font-data text-ink-2">{{ pt.max_weight != null ? `${pt.max_weight} kg` : NO_VALUE }}</td>
                    <td class="px-4 py-2.5 text-right font-data text-ink-2">{{ pt.total_volume.toLocaleString('es-ES') }} kg</td>
                    <td class="px-4 py-2.5 text-right font-data text-ink-3">{{ pt.sets }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UiCard>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const search = ref('')
const selectedExercise = ref<string | null>(null)

const METRIC_TABS = [
  { value: '1rm', label: '1RM est.' },
  { value: 'volumen', label: 'Volumen' },
  { value: 'peso', label: 'Peso máx.' }
] as const

const activeTab = ref('1rm')

const { data: exercises, pending: exercisePending } = useFetch('/api/progress')

const filteredExercises = computed(() => {
  if (!exercises.value) return []
  const q = search.value.toLowerCase()
  return q ? exercises.value.filter((e: any) => e.name.toLowerCase().includes(q)) : exercises.value
})

const chartData = ref<{ exercise: string; points: any[] } | null>(null)
const chartPending = ref(false)

const selectExercise = async (name: string) => {
  selectedExercise.value = name
  chartPending.value = true
  chartData.value = null
  try {
    chartData.value = await $fetch<{ exercise: string; points: any[] }>(`/api/progress/${encodeURIComponent(name)}`)
  } finally {
    chartPending.value = false
  }
}

const latestPoint = computed(() => {
  if (!chartData.value?.points.length) return null
  return chartData.value.points[chartData.value.points.length - 1]
})

const bestE1rm = computed(() => {
  const values = (chartData.value?.points ?? [])
    .map((p: any) => p.estimated_1rm)
    .filter((v: any): v is number => v != null)
  return values.length ? Math.max(...values) : null
})

/**
 * Best e1RM of the last 30 days against the best of the 30 before that.
 *
 * The previous version compared the first session ever logged with the latest,
 * so a lift that had stalled for a year still showed a large positive number
 * from progress made long ago. Returns null rather than 0 when either window is
 * empty — "no comparable data" is not "no progress".
 */
const rollingProgress = computed<number | null>(() => {
  const points = chartData.value?.points ?? []
  if (!points.length) return null

  const now = Date.now()
  const day = 86_400_000
  const bestIn = (fromDaysAgo: number, toDaysAgo: number): number | null => {
    const values = points
      .filter((p: any) => {
        const age = (now - new Date(p.date).getTime()) / day
        return age >= toDaysAgo && age < fromDaysAgo && p.estimated_1rm != null
      })
      .map((p: any) => p.estimated_1rm as number)
    return values.length ? Math.max(...values) : null
  }

  const recent = bestIn(30, 0)
  const previous = bestIn(60, 30)
  if (recent == null || previous == null) return null
  return recent - previous
})

const activePoints = computed(() => {
  if (!chartData.value?.points) return []
  return chartData.value.points
    .filter((p: any) => {
      if (activeTab.value === '1rm') return p.estimated_1rm != null
      if (activeTab.value === 'volumen') return p.total_volume > 0
      return p.max_weight != null
    })
    .map((p: any) => ({
      date: p.date,
      value: activeTab.value === '1rm' ? p.estimated_1rm
        : activeTab.value === 'volumen' ? p.total_volume
        : p.max_weight
    }))
})

const tabColor = computed(() =>
  seriesColor(activeTab.value === '1rm' ? 0 : activeTab.value === 'volumen' ? 4 : 2)
)

const tabFormatY = computed(() =>
  activeTab.value === 'volumen'
    ? (v: number) => `${Math.round(v)}kg`
    : (v: number) => `${v.toFixed(1)}kg`
)

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

const RECORD_LABELS: Record<string, string> = {
  max_weight: 'peso máximo',
  e1rm: '1RM estimado',
  volume: 'volumen',
  reps_at_weight: 'repeticiones'
}
const recordLabel = (t: string) => RECORD_LABELS[t] ?? t
</script>
