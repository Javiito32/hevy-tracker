<template>
  <div class="max-w-5xl mx-auto">
    <NuxtLink to="/calendar" class="text-blue-600 hover:underline mb-4 inline-block">← Back to Calendar</NuxtLink>

    <div v-if="pending" class="flex justify-center p-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-blue-500 border-t-transparent"></div>
    </div>

    <template v-else-if="workout">
      <div class="flex justify-between items-start mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-800">{{ workout.name }}</h1>
          <p class="text-gray-500">{{ formattedDate }} • {{ formatDuration(workout.duration) }}</p>
        </div>
        <div class="flex items-center gap-2">
          <span v-if="workout.ai_analysis" class="text-xs text-gray-400">Analizado anteriormente</span>
          <button
            @click="analyzeWithAI"
            :disabled="aiStatus === 'loading'"
            class="bg-purple-600 text-white px-5 py-2.5 rounded shadow hover:bg-purple-700 flex items-center transition disabled:opacity-50"
          >
            <span class="mr-2" v-if="aiStatus !== 'loading'">✨</span>
            <svg v-else class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {{ aiStatus === 'loading' ? 'Analizando...' : workout.ai_analysis ? 'Re-analizar' : 'Analizar con IA' }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div class="lg:col-span-2 space-y-6">
          <!-- Exercises -->
          <div class="bg-white rounded-lg shadow overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200">
              <h2 class="text-xl font-semibold text-gray-800">Ejercicios</h2>
            </div>
            <div class="divide-y divide-gray-100">
              <div v-if="!workout.exercises_summary || workout.exercises_summary.length === 0" class="p-6 text-gray-500">
                No hay ejercicios registrados para este entrenamiento.
              </div>

              <div v-for="(exercise, exIndex) in workout.exercises_summary" :key="exIndex" class="p-6 hover:bg-gray-50 transition">
                <div class="flex justify-between items-start mb-4">
                  <h3 class="font-medium text-lg text-gray-900">{{ exercise.name }}</h3>
                  <div class="text-right text-sm text-gray-500">
                    <!-- Strength metrics -->
                    <template v-if="getExerciseType(exercise) === 'strength'">
                      <span v-if="exercise.estimated_1rm" class="mr-3">1RM: <span class="font-medium text-gray-700">{{ parseFloat(exercise.estimated_1rm).toFixed(1) }}kg</span></span>
                      <span v-if="exercise.total_volume">Vol: <span class="font-medium text-gray-700">{{ exercise.total_volume.toLocaleString() }}kg</span></span>
                    </template>
                    <!-- Cardio/duration metrics -->
                    <template v-else>
                      <span v-if="exercise.total_distance_meters" class="mr-3">Dist: <span class="font-medium text-gray-700">{{ formatDistance(exercise.total_distance_meters) }}</span></span>
                      <span v-if="exercise.total_duration_seconds">Tiempo: <span class="font-medium text-gray-700">{{ formatSetDuration(exercise.total_duration_seconds) }}</span></span>
                    </template>
                  </div>
                </div>

                <div class="bg-white border rounded" v-if="exercise.sets_details && exercise.sets_details.length > 0">
                  <!-- Strength table -->
                  <template v-if="getExerciseType(exercise) === 'strength'">
                    <div class="grid grid-cols-4 gap-2 text-xs font-semibold text-gray-500 text-center py-2 bg-gray-50 uppercase tracking-wider border-b">
                      <div>Set</div><div>kg</div><div>Reps</div><div>RPE</div>
                    </div>
                    <div v-for="(set, setIndex) in exercise.sets_details" :key="setIndex"
                      class="grid grid-cols-4 gap-2 text-sm text-center py-2 border-b last:border-b-0 hover:bg-gray-50">
                      <div class="text-gray-500">{{ setIndex + 1 }}</div>
                      <div class="font-medium">{{ set.weight ?? '-' }}</div>
                      <div class="font-medium">{{ set.reps ?? '-' }}</div>
                      <div class="text-gray-500">{{ set.rpe || '-' }}</div>
                    </div>
                  </template>
                  <!-- Cardio table (distance + duration) -->
                  <template v-else-if="getExerciseType(exercise) === 'cardio'">
                    <div class="grid grid-cols-4 gap-2 text-xs font-semibold text-gray-500 text-center py-2 bg-gray-50 uppercase tracking-wider border-b">
                      <div>Set</div><div>Distancia</div><div>Tiempo</div><div>RPE</div>
                    </div>
                    <div v-for="(set, setIndex) in exercise.sets_details" :key="setIndex"
                      class="grid grid-cols-4 gap-2 text-sm text-center py-2 border-b last:border-b-0 hover:bg-gray-50">
                      <div class="text-gray-500">{{ setIndex + 1 }}</div>
                      <div class="font-medium">{{ formatDistance(set.distance_meters) }}</div>
                      <div class="font-medium">{{ formatSetDuration(set.duration_seconds) }}</div>
                      <div class="text-gray-500">{{ set.rpe || '-' }}</div>
                    </div>
                  </template>
                  <!-- Duration-only table (planks, etc.) -->
                  <template v-else>
                    <div class="grid grid-cols-3 gap-2 text-xs font-semibold text-gray-500 text-center py-2 bg-gray-50 uppercase tracking-wider border-b">
                      <div>Set</div><div>Tiempo</div><div>RPE</div>
                    </div>
                    <div v-for="(set, setIndex) in exercise.sets_details" :key="setIndex"
                      class="grid grid-cols-3 gap-2 text-sm text-center py-2 border-b last:border-b-0 hover:bg-gray-50">
                      <div class="text-gray-500">{{ setIndex + 1 }}</div>
                      <div class="font-medium">{{ formatSetDuration(set.duration_seconds) }}</div>
                      <div class="text-gray-500">{{ set.rpe || '-' }}</div>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-6">
          <!-- AI Feedback Card -->
          <div v-if="displayedAnalysis || aiStatus === 'error'" class="bg-gradient-to-br from-purple-50 to-white rounded-lg shadow border border-purple-100 p-6 relative overflow-hidden">
            <div class="absolute top-0 left-0 w-1 h-full" :class="aiStatus === 'error' ? 'bg-red-400' : 'bg-purple-500'"></div>
            <h2 class="text-lg font-semibold mb-3 flex items-center" :class="aiStatus === 'error' ? 'text-red-700' : 'text-purple-900'">
              <span class="mr-2">{{ aiStatus === 'error' ? '⚠️' : '✨' }}</span>
              {{ aiStatus === 'error' ? 'Error en análisis' : 'Análisis IA' }}
            </h2>
            <div v-if="aiStatus === 'error'" class="text-sm text-red-600">{{ aiError }}</div>
            <div v-else class="prose prose-sm text-gray-700 max-w-none" v-html="renderMarkdown(displayedAnalysis)"></div>
            <div class="mt-4 pt-3 border-t border-purple-100">
              <NuxtLink to="/chat" class="text-purple-600 text-sm font-medium hover:text-purple-800">Continuar análisis en el Chat →</NuxtLink>
            </div>
          </div>

          <!-- Stats -->
          <div class="bg-white rounded-lg shadow p-6 border-t-4 border-blue-500">
            <h2 class="text-lg font-semibold text-gray-800 mb-4">Estadísticas</h2>
            <div class="space-y-4">
              <div class="flex justify-between items-end border-b border-gray-100 pb-2">
                <span class="text-gray-600">Volumen total</span>
                <span class="font-bold text-lg text-gray-900">{{ workout.total_volume?.toLocaleString() }} <span class="text-sm font-normal text-gray-500">kg</span></span>
              </div>
              <div class="flex justify-between items-end border-b border-gray-100 pb-2">
                <span class="text-gray-600">Ejercicios</span>
                <span class="font-bold text-lg text-gray-900">{{ workout.exercises_summary?.length || 0 }}</span>
              </div>
              <div class="flex justify-between items-end pb-2">
                <span class="text-gray-600">RPE promedio</span>
                <span class="font-bold text-lg text-gray-900">{{ workout.rpe_avg || 'N/A' }}</span>
              </div>
            </div>
          </div>

          <!-- Our Notes -->
          <div class="bg-white rounded-lg shadow p-6">
            <div class="flex justify-between items-center mb-3">
              <h2 class="text-lg font-semibold text-gray-800">Mis notas</h2>
              <button v-if="!editingNotes" @click="startEditNotes" class="text-xs text-blue-600 hover:text-blue-800">Editar</button>
            </div>
            <template v-if="editingNotes">
              <textarea
                v-model="localNotes"
                rows="4"
                class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 resize-none"
                placeholder="Fatiga, ajustes, sensaciones..."
                autofocus
              ></textarea>
              <div class="mt-2 flex gap-2">
                <button @click="saveNotes" :disabled="notesSaveStatus === 'saving'" class="text-sm bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 disabled:opacity-50 transition">
                  {{ notesSaveStatus === 'saving' ? 'Guardando...' : 'Guardar' }}
                </button>
                <button @click="cancelEditNotes" class="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">Cancelar</button>
                <span v-if="notesSaveStatus === 'error'" class="text-xs text-red-500 self-center">Error al guardar</span>
              </div>
            </template>
            <template v-else>
              <div v-if="localNotes" class="p-3 bg-gray-50 rounded text-sm text-gray-700 whitespace-pre-wrap">{{ localNotes }}</div>
              <div v-else class="p-3 bg-gray-50 rounded text-sm text-gray-400 italic">Sin notas. Pulsa Editar para añadir.</div>
            </template>
          </div>

          <!-- Hevy Notes -->
          <div v-if="workout.description" class="bg-white rounded-lg shadow p-6">
            <h2 class="text-lg font-semibold text-gray-800 mb-3">Notas de Hevy</h2>
            <div class="p-3 bg-gray-50 rounded text-sm text-gray-700 whitespace-pre-wrap">{{ workout.description }}</div>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="text-center py-12">
      <p class="text-gray-500">Entrenamiento no encontrado.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const workoutId = route.params.id

// Fetch real data
const { data: workout, pending } = useFetch(`/api/workouts/${workoutId}`)

const formattedDate = computed(() => {
  if (!workout.value) return ''
  const dateStr = workout.value.start_time || workout.value.date
  return new Date(dateStr).toLocaleString(undefined, { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
})

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return 'N/A'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const formatSetDuration = (seconds?: number | null): string => {
  if (!seconds) return '-'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

const formatDistance = (meters?: number | null): string => {
  if (!meters) return '-'
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${meters} m`
}

const getExerciseType = (ex: any): 'strength' | 'cardio' | 'duration' => {
  if (ex.type === 'cardio') return 'cardio'
  if (ex.type === 'duration') return 'duration'
  const sets = ex.sets_details || []
  if (sets.some((s: any) => (s.weight != null && Number(s.weight) > 0) || (s.reps != null && Number(s.reps) > 0))) return 'strength'
  if (sets.some((s: any) => s.distance_meters != null && s.distance_meters > 0)) return 'cardio'
  if (sets.some((s: any) => s.duration_seconds != null && s.duration_seconds > 0)) return 'duration'
  return 'strength'
}

// Our notes (editable, separate from Hevy description)
const localNotes = ref((workout.value as any)?.notes ?? '')
const editingNotes = ref(false)
const notesSaveStatus = ref<'idle' | 'saving' | 'error'>('idle')

watch(workout, (w) => {
  if (!editingNotes.value) localNotes.value = (w as any)?.notes ?? ''
})

const startEditNotes = () => {
  notesSaveStatus.value = 'idle'
  editingNotes.value = true
}

const cancelEditNotes = () => {
  localNotes.value = (workout.value as any)?.notes ?? ''
  editingNotes.value = false
  notesSaveStatus.value = 'idle'
}

const saveNotes = async () => {
  notesSaveStatus.value = 'saving'
  try {
    await $fetch(`/api/workouts/${workoutId}`, {
      method: 'PATCH',
      body: { notes: localNotes.value || null }
    })
    ;(workout.value as any).notes = localNotes.value || null
    editingNotes.value = false
    notesSaveStatus.value = 'idle'
  } catch {
    notesSaveStatus.value = 'error'
  }
}

const aiStatus = ref('idle')
const aiAnalysis = ref('')
const aiError = ref('')

// Show saved analysis on load, or the freshly generated one
const displayedAnalysis = computed(() =>
  aiAnalysis.value || (workout.value as any)?.ai_analysis || ''
)

const analyzeWithAI = async () => {
  aiStatus.value = 'loading'
  aiError.value = ''
  aiAnalysis.value = ''
  try {
    const res = await $fetch<{ success: boolean; analysis: string }>(`/api/workouts/${workoutId}/analyze`, { method: 'POST' })
    aiAnalysis.value = res.analysis
    aiStatus.value = 'completed'
  } catch (err: any) {
    aiError.value = err?.data?.statusMessage || 'Error al conectar con la IA. Verifica tu API key en Ajustes.'
    aiStatus.value = 'error'
  }
}

const renderMarkdown = (text: string) => {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="font-bold text-base mt-4 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-bold text-lg mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="font-bold text-xl mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/\n\n/g, '</p><p class="mb-2">')
    .replace(/^/, '<p class="mb-2">')
    .replace(/$/, '</p>')
}
</script>
