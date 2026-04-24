<template>
  <div class="max-w-6xl mx-auto">
    <h1 class="text-3xl font-bold mb-6 text-gray-800">Progresión por Ejercicio</h1>

    <div v-if="exercisePending" class="flex justify-center py-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-blue-500 border-t-transparent"></div>
    </div>

    <div v-else class="flex flex-col lg:flex-row gap-6">
      <!-- Sidebar: exercise list -->
      <div class="lg:w-72 flex-shrink-0">
        <div class="bg-white rounded-lg shadow overflow-hidden">
          <div class="px-4 py-3 border-b border-gray-200">
            <input
              v-model="search"
              type="text"
              placeholder="Buscar ejercicio..."
              class="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div class="overflow-y-auto max-h-[calc(100vh-260px)]">
            <div v-if="filteredExercises.length === 0" class="p-4 text-gray-500 text-sm text-center">
              No se encontraron ejercicios.
            </div>
            <button
              v-for="ex in filteredExercises"
              :key="ex.name"
              @click="selectExercise(ex.name)"
              class="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-blue-50 transition"
              :class="selectedExercise === ex.name ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''"
            >
              <p class="font-medium text-gray-900 text-sm">{{ ex.name }}</p>
              <div class="flex items-center justify-between mt-0.5">
                <span class="text-xs text-gray-500">{{ ex.sessionCount }} sesiones</span>
                <span v-if="ex.lastEstimated1rm" class="text-xs font-medium text-blue-600">
                  1RM {{ ex.lastEstimated1rm.toFixed(1) }}kg
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- Main chart area -->
      <div class="flex-grow">
        <!-- No exercise selected -->
        <div v-if="!selectedExercise" class="bg-white rounded-lg shadow p-12 text-center text-gray-400">
          <p class="text-4xl mb-3">📈</p>
          <p class="font-medium text-gray-500">Selecciona un ejercicio para ver su progresión</p>
        </div>

        <!-- Loading chart data -->
        <div v-else-if="chartPending" class="bg-white rounded-lg shadow p-12 flex justify-center">
          <div class="animate-spin w-8 h-8 rounded-full border-4 border-blue-500 border-t-transparent"></div>
        </div>

        <!-- Chart -->
        <div v-else-if="chartData" class="space-y-6">
          <div class="bg-white rounded-lg shadow p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-xl font-semibold text-gray-800">{{ selectedExercise }}</h2>
              <div class="flex gap-2">
                <button
                  v-for="tab in ['1rm', 'volumen', 'peso']"
                  :key="tab"
                  @click="activeTab = tab"
                  class="text-xs px-3 py-1.5 rounded-full border transition"
                  :class="activeTab === tab
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'text-gray-600 border-gray-300 hover:bg-gray-50'"
                >
                  {{ tab === '1rm' ? '1RM Est.' : tab === 'volumen' ? 'Volumen' : 'Peso máx.' }}
                </button>
              </div>
            </div>

            <!-- Summary stats -->
            <div class="grid grid-cols-3 gap-4 mb-6">
              <div class="bg-blue-50 rounded-lg p-3 text-center">
                <p class="text-xs text-blue-600 font-medium uppercase tracking-wide mb-1">1RM actual</p>
                <p class="text-2xl font-bold text-blue-800">{{ latestPoint?.estimated_1rm?.toFixed(1) ?? '-' }}<span class="text-sm font-normal ml-1">kg</span></p>
              </div>
              <div class="bg-green-50 rounded-lg p-3 text-center">
                <p class="text-xs text-green-600 font-medium uppercase tracking-wide mb-1">Progreso 1RM</p>
                <p class="text-2xl font-bold" :class="rmProgress >= 0 ? 'text-green-700' : 'text-red-600'">
                  {{ rmProgress >= 0 ? '+' : '' }}{{ rmProgress.toFixed(1) }}<span class="text-sm font-normal ml-1">kg</span>
                </p>
              </div>
              <div class="bg-purple-50 rounded-lg p-3 text-center">
                <p class="text-xs text-purple-600 font-medium uppercase tracking-wide mb-1">Sesiones</p>
                <p class="text-2xl font-bold text-purple-800">{{ chartData.points.length }}</p>
              </div>
            </div>

            <!-- Chart -->
            <ChartsLineChart
              v-if="activePoints.length"
              :points="activePoints"
              :color="tabColor"
              :format-y="tabFormatY"
              :H="220"
            />
            <p v-else class="text-center text-gray-400 py-8 text-sm">Sin datos para esta métrica.</p>
          </div>

          <!-- Sessions table -->
          <div class="bg-white rounded-lg shadow overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200">
              <h3 class="font-semibold text-gray-800">Historial de sesiones</h3>
            </div>
            <table class="w-full text-sm">
              <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th class="px-4 py-2 text-left">Fecha</th>
                  <th class="px-4 py-2 text-right">1RM Est.</th>
                  <th class="px-4 py-2 text-right">Peso máx.</th>
                  <th class="px-4 py-2 text-right">Volumen</th>
                  <th class="px-4 py-2 text-right">Sets</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr v-for="(pt, i) in [...chartData.points].reverse()" :key="i" class="hover:bg-gray-50">
                  <td class="px-4 py-2 text-gray-700">{{ formatDate(pt.date) }}</td>
                  <td class="px-4 py-2 text-right font-medium text-blue-700">{{ pt.estimated_1rm?.toFixed(1) ?? '-' }} kg</td>
                  <td class="px-4 py-2 text-right text-gray-600">{{ pt.max_weight ?? '-' }} kg</td>
                  <td class="px-4 py-2 text-right text-gray-600">{{ pt.total_volume.toLocaleString() }} kg</td>
                  <td class="px-4 py-2 text-right text-gray-500">{{ pt.sets }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const search = ref('')
const selectedExercise = ref<string | null>(null)
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

const firstPoint = computed(() => chartData.value?.points[0] ?? null)

const rmProgress = computed(() => {
  if (!latestPoint.value?.estimated_1rm || !firstPoint.value?.estimated_1rm) return 0
  return latestPoint.value.estimated_1rm - firstPoint.value.estimated_1rm
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
  activeTab.value === '1rm' ? '#3b82f6' : activeTab.value === 'volumen' ? '#8b5cf6' : '#10b981'
)

const tabFormatY = computed(() =>
  activeTab.value === 'volumen'
    ? (v: number) => `${Math.round(v)}kg`
    : (v: number) => `${v.toFixed(1)}kg`
)

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
</script>
