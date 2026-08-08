<template>
  <div class="max-w-5xl mx-auto">
    <NuxtLink to="/calendar" class="text-indigo-400 hover:text-indigo-300 mb-4 inline-block transition">← Volver al calendario</NuxtLink>

    <div v-if="pending" class="flex justify-center p-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent"></div>
    </div>

    <template v-else-if="workout">
      <div class="flex justify-between items-start mb-6">
        <div>
          <h1 class="text-3xl font-bold text-slate-100">{{ workout.name }}</h1>
          <p class="text-slate-500">{{ formattedDate }} • {{ formatDuration(workout.duration) }}</p>
        </div>
        <div class="flex items-center gap-2">
          <span v-if="workout.ai_analysis" class="text-xs text-slate-500">Analizado anteriormente</span>
          <button
            @click="analyzeWithAI"
            :disabled="aiStatus === 'loading'"
            class="bg-violet-600 text-white px-5 py-2.5 rounded-lg hover:bg-violet-500 flex items-center transition disabled:opacity-50"
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
          <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4 flex-wrap">
              <h2 class="text-lg font-semibold text-slate-200">Ejercicios</h2>
              <!-- Only shown when the workout actually contains marked sets, so the
                   legend never explains symbols that aren't on screen. -->
              <div v-if="setTypeLegend.length" class="flex items-center gap-3 text-xs text-slate-500">
                <span v-for="entry in setTypeLegend" :key="entry.label" class="flex items-center gap-1.5">
                  <span class="inline-flex items-center justify-center min-w-[1.25rem] px-1 rounded text-[10px] font-semibold" :class="entry.badge">{{ entry.mark }}</span>
                  {{ entry.label }}
                </span>
              </div>
            </div>
            <div class="divide-y divide-slate-800">
              <div v-if="!workout.exercises_summary || workout.exercises_summary.length === 0" class="p-6 text-slate-500">
                No hay ejercicios registrados para este entrenamiento.
              </div>

              <div v-for="(exercise, exIndex) in workout.exercises_summary" :key="exIndex" class="p-6 hover:bg-slate-800/50 transition">
                <div class="flex justify-between items-start mb-4">
                  <div>
                    <h3 class="font-medium text-lg text-slate-100">{{ exercise.name }}</h3>
                    <p class="text-xs text-slate-500 mt-0.5">{{ describeSetCount(exercise.sets_details || []) }}</p>
                  </div>
                  <div class="text-right text-sm text-slate-500">
                    <template v-if="getExerciseType(exercise) === 'strength'">
                      <span v-if="exercise.estimated_1rm" class="mr-3">1RM: <span class="font-medium text-slate-300">{{ parseFloat(exercise.estimated_1rm).toFixed(1) }}kg</span></span>
                      <span v-if="exercise.total_volume">Vol: <span class="font-medium text-slate-300">{{ exercise.total_volume.toLocaleString() }}kg</span></span>
                    </template>
                    <template v-else>
                      <span v-if="exercise.total_distance_meters" class="mr-3">Dist: <span class="font-medium text-slate-300">{{ formatDistance(exercise.total_distance_meters) }}</span></span>
                      <span v-if="exercise.total_duration_seconds">Tiempo: <span class="font-medium text-slate-300">{{ formatSetDuration(exercise.total_duration_seconds) }}</span></span>
                    </template>
                  </div>
                </div>

                <div class="bg-slate-800 border border-slate-700 rounded-lg" v-if="exercise.sets_details && exercise.sets_details.length > 0">
                  <template v-if="getExerciseType(exercise) === 'strength'">
                    <div class="grid grid-cols-4 gap-2 text-xs font-semibold text-slate-500 text-center py-2 bg-slate-800 uppercase tracking-wider border-b border-slate-700">
                      <div>Set</div><div>kg</div><div>Reps</div><div>RPE</div>
                    </div>
                    <div v-for="({ set, marker, style }, setIndex) in numberSets(exercise.sets_details)" :key="setIndex"
                      class="grid grid-cols-4 gap-2 text-sm text-center py-2 border-b border-slate-700 last:border-b-0 hover:bg-slate-700/50 transition"
                      :class="style.row">
                      <div>
                        <span class="inline-flex items-center justify-center min-w-[1.5rem] px-1 rounded text-xs font-semibold" :class="style.badge" :title="style.label">{{ marker }}</span>
                      </div>
                      <div class="font-medium text-slate-200">{{ set.weight ?? '-' }}</div>
                      <div class="font-medium text-slate-200">{{ set.reps ?? '-' }}</div>
                      <div class="text-slate-500">{{ set.rpe || '-' }}</div>
                    </div>
                  </template>
                  <template v-else-if="getExerciseType(exercise) === 'cardio'">
                    <div class="grid grid-cols-4 gap-2 text-xs font-semibold text-slate-500 text-center py-2 bg-slate-800 uppercase tracking-wider border-b border-slate-700">
                      <div>Set</div><div>Distancia</div><div>Tiempo</div><div>RPE</div>
                    </div>
                    <div v-for="({ set, marker, style }, setIndex) in numberSets(exercise.sets_details)" :key="setIndex"
                      class="grid grid-cols-4 gap-2 text-sm text-center py-2 border-b border-slate-700 last:border-b-0 hover:bg-slate-700/50 transition"
                      :class="style.row">
                      <div>
                        <span class="inline-flex items-center justify-center min-w-[1.5rem] px-1 rounded text-xs font-semibold" :class="style.badge" :title="style.label">{{ marker }}</span>
                      </div>
                      <div class="font-medium text-slate-200">{{ formatDistance(set.distance_meters) }}</div>
                      <div class="font-medium text-slate-200">{{ formatSetDuration(set.duration_seconds) }}</div>
                      <div class="text-slate-500">{{ set.rpe || '-' }}</div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="grid grid-cols-3 gap-2 text-xs font-semibold text-slate-500 text-center py-2 bg-slate-800 uppercase tracking-wider border-b border-slate-700">
                      <div>Set</div><div>Tiempo</div><div>RPE</div>
                    </div>
                    <div v-for="({ set, marker, style }, setIndex) in numberSets(exercise.sets_details)" :key="setIndex"
                      class="grid grid-cols-3 gap-2 text-sm text-center py-2 border-b border-slate-700 last:border-b-0 hover:bg-slate-700/50 transition"
                      :class="style.row">
                      <div>
                        <span class="inline-flex items-center justify-center min-w-[1.5rem] px-1 rounded text-xs font-semibold" :class="style.badge" :title="style.label">{{ marker }}</span>
                      </div>
                      <div class="font-medium text-slate-200">{{ formatSetDuration(set.duration_seconds) }}</div>
                      <div class="text-slate-500">{{ set.rpe || '-' }}</div>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-6">
          <!-- AI Feedback Card -->
          <div v-if="displayedAnalysis || aiStatus === 'error'" class="bg-violet-950/30 border border-violet-900 rounded-xl p-6 relative overflow-hidden">
            <div class="absolute top-0 left-0 w-1 h-full" :class="aiStatus === 'error' ? 'bg-rose-500' : 'bg-violet-500'"></div>
            <h2 class="text-base font-semibold mb-3 flex items-center" :class="aiStatus === 'error' ? 'text-rose-400' : 'text-violet-300'">
              <span class="mr-2">{{ aiStatus === 'error' ? '⚠️' : '✨' }}</span>
              {{ aiStatus === 'error' ? 'Error en análisis' : 'Análisis IA' }}
            </h2>
            <div v-if="aiStatus === 'error'" class="text-sm text-rose-400">{{ aiError }}</div>
            <div v-else class="prose prose-sm prose-invert text-slate-300 max-w-none" v-html="renderMarkdown(displayedAnalysis)"></div>
            <p v-if="isAdmin && displayedModel" class="text-[10px] font-mono text-slate-600 mt-2">Modelo: {{ displayedModel }}</p>
            <div class="mt-4 pt-3 border-t border-violet-900">
              <NuxtLink to="/chat" class="text-violet-400 text-sm font-medium hover:text-violet-300 transition">Continuar análisis en el Chat →</NuxtLink>
            </div>
          </div>

          <!-- Stats -->
          <div class="bg-slate-900 rounded-xl border border-slate-800 border-t-4 border-t-indigo-500 p-6">
            <h2 class="text-base font-semibold text-slate-200 mb-4">Estadísticas</h2>
            <div class="space-y-4">
              <div class="flex justify-between items-end border-b border-slate-800 pb-2">
                <span class="text-slate-500">Volumen total</span>
                <span class="font-bold text-lg text-slate-100">{{ workout.total_volume?.toLocaleString() }} <span class="text-sm font-normal text-slate-500">kg</span></span>
              </div>
              <div class="flex justify-between items-end border-b border-slate-800 pb-2">
                <span class="text-slate-500">Ejercicios</span>
                <span class="font-bold text-lg text-slate-100">{{ workout.exercises_summary?.length || 0 }}</span>
              </div>
              <div class="flex justify-between items-end pb-2">
                <span class="text-slate-500">RPE promedio</span>
                <span class="font-bold text-lg text-slate-100">{{ workout.rpe_avg || 'N/A' }}</span>
              </div>
            </div>
          </div>

          <!-- Our Notes -->
          <div class="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <div class="flex justify-between items-center mb-3">
              <h2 class="text-base font-semibold text-slate-200">Mis notas</h2>
              <button v-if="!editingNotes" @click="startEditNotes" class="text-xs text-indigo-400 hover:text-indigo-300 transition">Editar</button>
            </div>
            <template v-if="editingNotes">
              <textarea
                v-model="localNotes"
                rows="4"
                class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition"
                placeholder="Fatiga, ajustes, sensaciones..."
                autofocus
              ></textarea>
              <div class="mt-2 flex gap-2">
                <button @click="saveNotes" :disabled="notesSaveStatus === 'saving'" class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-500 disabled:opacity-50 transition">
                  {{ notesSaveStatus === 'saving' ? 'Guardando...' : 'Guardar' }}
                </button>
                <button @click="cancelEditNotes" class="text-sm text-slate-500 hover:text-slate-300 px-3 py-1.5 transition">Cancelar</button>
                <span v-if="notesSaveStatus === 'error'" class="text-xs text-rose-400 self-center">Error al guardar</span>
              </div>
            </template>
            <template v-else>
              <div v-if="localNotes" class="p-3 bg-slate-800 rounded-lg text-sm text-slate-300 whitespace-pre-wrap">{{ localNotes }}</div>
              <div v-else class="p-3 bg-slate-800 rounded-lg text-sm text-slate-600 italic">Sin notas. Pulsa Editar para añadir.</div>
            </template>
          </div>

          <!-- Hevy Notes -->
          <div v-if="workout.description" class="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <h2 class="text-base font-semibold text-slate-200 mb-3">Notas de Hevy</h2>
            <div class="p-3 bg-slate-800 rounded-lg text-sm text-slate-400 whitespace-pre-wrap">{{ workout.description }}</div>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="text-center py-12">
      <p class="text-slate-500">Entrenamiento no encontrado.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const workoutId = route.params.id

const { session } = useUserSession()
const isAdmin = computed(() => (session.value?.user as any)?.role === 'admin')

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

/**
 * The distinct non-normal set types present in this workout, in a fixed order
 * so the legend doesn't reshuffle between workouts.
 * numberSets / describeSetCount / setTypeStyle come from app/utils/training.ts.
 */
const setTypeLegend = computed(() => {
  const present = new Set<string>()
  for (const ex of (workout.value as any)?.exercises_summary ?? []) {
    for (const s of ex.sets_details ?? []) {
      const t = setType(s)
      if (t !== 'normal') present.add(t)
    }
  }
  return (['warmup', 'dropset', 'failure'] as const)
    .filter(t => present.has(t))
    .map(t => {
      const style = setTypeStyle({ type: t })
      return { label: style.label, mark: style.mark, badge: style.badge }
    })
})

const getExerciseType = (ex: any): 'strength' | 'cardio' | 'duration' => {
  if (ex.type === 'cardio') return 'cardio'
  if (ex.type === 'duration') return 'duration'
  const sets = ex.sets_details || []
  if (sets.some((s: any) => (s.weight != null && Number(s.weight) > 0) || (s.reps != null && Number(s.reps) > 0))) return 'strength'
  if (sets.some((s: any) => s.distance_meters != null && s.distance_meters > 0)) return 'cardio'
  if (sets.some((s: any) => s.duration_seconds != null && s.duration_seconds > 0)) return 'duration'
  return 'strength'
}

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
const aiModel = ref('')
const aiError = ref('')

const displayedAnalysis = computed(() =>
  aiAnalysis.value || (workout.value as any)?.ai_analysis || ''
)
const displayedModel = computed(() =>
  aiModel.value || (workout.value as any)?.ai_model || ''
)

const analyzeWithAI = async () => {
  aiStatus.value = 'loading'
  aiError.value = ''
  aiAnalysis.value = ''
  try {
    const res = await $fetch<{ success: boolean; analysis: string; model: string }>(`/api/workouts/${workoutId}/analyze`, { method: 'POST' })
    aiAnalysis.value = res.analysis
    aiModel.value = res.model ?? ''
    aiStatus.value = 'completed'
  } catch (err: any) {
    aiError.value = err?.data?.statusMessage || 'Error al conectar con la IA. Verifica tu API key en Ajustes.'
    aiStatus.value = 'error'
  }
}

// renderMarkdown comes from app/utils/markdown.ts (auto-imported).
</script>
