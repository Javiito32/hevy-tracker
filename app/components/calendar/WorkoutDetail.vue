<template>
  <div class="bg-white rounded-lg shadow h-full flex flex-col">
    <!-- Header -->
    <div class="px-6 py-4 border-b border-gray-200">
      <h2 class="text-xl font-semibold text-gray-800">
        {{ formattedDate }}
      </h2>
      <p v-if="!workout" class="text-sm text-gray-500 mt-1">No workout recorded.</p>
    </div>

    <div v-if="workout" class="flex-grow overflow-y-auto p-6 space-y-6">

      <!-- Workout Title and Core Stats -->
      <div>
        <div class="flex justify-between items-start mb-2">
          <h3 class="text-lg font-medium text-gray-900">{{ workout.name }}</h3>
          <span class="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">RPE: {{ workout.rpe_avg || 'N/A' }}</span>
        </div>
        <div class="grid grid-cols-2 gap-4 text-sm bg-gray-50 p-3 rounded-lg border border-gray-100">
          <div>
            <p class="text-gray-500 mb-1">Volumen</p>
            <p class="font-medium">{{ workout.total_volume?.toLocaleString() || 0 }} kg</p>
          </div>
          <div>
            <p class="text-gray-500 mb-1">Duración</p>
            <p class="font-medium">{{ formatDuration(workout.duration) }}</p>
          </div>
        </div>
      </div>

      <!-- Exercises -->
      <div v-if="exercises.length">
        <h4 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">Ejercicios</h4>
        <div class="space-y-4">
          <div v-for="(ex, index) in exercises" :key="index" class="text-sm">
            <div class="flex justify-between font-medium text-gray-800 mb-1 border-b border-gray-100 pb-1">
              <span>{{ ex.name }}</span>
              <span class="text-gray-500">{{ ex.sets }} sets</span>
            </div>
            <div class="text-gray-600 flex justify-between">
              <template v-if="ex.type === 'cardio' || ex.type === 'duration'">
                <span v-if="ex.total_distance_meters">{{ formatDistance(ex.total_distance_meters) }}</span>
                <span v-if="ex.total_duration_seconds">{{ formatSetDuration(ex.total_duration_seconds) }}</span>
              </template>
              <template v-else>
                <span>Est 1RM: {{ ex.estimated_1rm ? parseFloat(ex.estimated_1rm).toFixed(1) : '-' }} kg</span>
                <span>Vol: {{ ex.total_volume?.toLocaleString() || '-' }} kg</span>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Our Notes -->
      <div>
        <h4 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-2">Mis notas</h4>
        <textarea
          v-model="localNotes"
          rows="3"
          class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-blue-500 focus:border-blue-500 resize-none"
          placeholder="Fatiga, ajustes, sensaciones..."
        ></textarea>
        <div class="mt-2 flex items-center gap-3">
          <button
            @click="saveNotes"
            :disabled="saveStatus === 'saving' || !isDirty"
            class="text-sm bg-gray-100 text-gray-800 px-3 py-1.5 rounded hover:bg-gray-200 transition disabled:opacity-50"
          >
            {{ saveStatus === 'saving' ? 'Guardando...' : 'Guardar' }}
          </button>
          <span v-if="saveStatus === 'saved'" class="text-xs text-green-600">Guardado</span>
          <span v-if="saveStatus === 'error'" class="text-xs text-red-500">Error al guardar</span>
        </div>
      </div>

      <!-- Hevy Notes -->
      <div v-if="workout.description">
        <h4 class="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-2">Notas de Hevy</h4>
        <div class="p-3 bg-gray-50 rounded text-sm text-gray-600 whitespace-pre-wrap">{{ workout.description }}</div>
      </div>

      <!-- AI Action -->
      <div class="pt-4 border-t border-gray-200">
        <NuxtLink :to="`/workouts/${workout.id}`" class="block w-full bg-blue-600 text-white text-center py-2.5 rounded shadow hover:bg-blue-700 transition flex justify-center items-center">
          Ver detalle y análisis IA
        </NuxtLink>
      </div>
    </div>

    <div v-else class="flex-grow flex items-center justify-center p-6 text-gray-400 flex-col">
      <svg class="w-12 h-12 mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
      <p class="text-sm text-center">Día de descanso o sin entreno. Selecciona una fecha resaltada para ver el detalle.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{
  date: Date | null
  workout: any | null
}>()

const emit = defineEmits<{ 'notes-saved': [workoutId: string, notes: string | null] }>()

const localNotes = ref('')
const savedNotes = ref('')
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

const isDirty = computed(() => localNotes.value !== savedNotes.value)

watch(() => props.workout, (w) => {
  localNotes.value = w?.notes ?? ''
  savedNotes.value = w?.notes ?? ''
  saveStatus.value = 'idle'
}, { immediate: true })

const saveNotes = async () => {
  if (!props.workout?.id) return
  saveStatus.value = 'saving'
  try {
    await $fetch(`/api/workouts/${props.workout.id}`, {
      method: 'PATCH',
      body: { notes: localNotes.value || null }
    })
    savedNotes.value = localNotes.value
    emit('notes-saved', props.workout.id, localNotes.value || null)
    saveStatus.value = 'saved'
    setTimeout(() => { if (saveStatus.value === 'saved') saveStatus.value = 'idle' }, 2000)
  } catch {
    saveStatus.value = 'error'
  }
}

const formattedDate = computed(() => {
  if (!props.date) return 'Selecciona una fecha'
  return new Intl.DateTimeFormat('es-ES', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(props.date)
})

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return '-'
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

const exercises = computed(() => {
  const es = props.workout?.exercises_summary
  if (!es) return []
  if (Array.isArray(es)) return es
  try { return JSON.parse(es) } catch { return [] }
})
</script>
