<template>
  <div class="bg-surface rounded-card border border-line h-full flex flex-col">
    <div class="px-5 py-3.5 border-b border-line">
      <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-1">Día</p>
      <h2 class="font-display text-sm font-semibold tracking-tight text-ink first-letter:uppercase">
        {{ formattedDate }}
      </h2>
    </div>

    <div v-if="workout" class="flex-grow overflow-y-auto custom-scrollbar p-5 space-y-6">
      <div>
        <div class="flex justify-between items-start gap-3 mb-3">
          <h3 class="text-sm font-medium text-ink min-w-0">{{ workout.name }}</h3>
          <span class="font-data text-[11px] bg-surface-2 text-ink-2 px-2 py-0.5 rounded flex-shrink-0">
            RPE {{ workout.rpe_avg ?? NO_VALUE }}
          </span>
        </div>
        <dl class="grid grid-cols-2 gap-4 bg-surface-2 p-3 rounded-lg border border-line">
          <div>
            <dt class="text-[11px] text-ink-3 mb-0.5">Volumen</dt>
            <dd class="font-data text-sm text-ink">{{ workout.total_volume?.toLocaleString('es-ES') ?? 0 }} kg</dd>
          </div>
          <div>
            <dt class="text-[11px] text-ink-3 mb-0.5">Duración</dt>
            <dd class="font-data text-sm text-ink">{{ formatDuration(workout.duration) }}</dd>
          </div>
        </dl>
      </div>

      <div v-if="exercises.length">
        <h4 class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-3">Ejercicios</h4>
        <ul class="space-y-3.5">
          <li v-for="(ex, index) in exercises" :key="index" class="text-sm">
            <div class="flex justify-between items-baseline gap-3 text-ink mb-1 border-b border-line pb-1">
              <span class="min-w-0 truncate font-medium">{{ ex.name }}</span>
              <!-- describeSetCount reports working sets, flagging warm-ups apart. -->
              <span class="font-data text-[11px] text-ink-3 whitespace-nowrap">{{ describeSetCount(ex.sets_details || []) }}</span>
            </div>
            <div class="font-data text-xs text-ink-2 flex justify-between gap-3">
              <template v-if="ex.type === 'cardio' || ex.type === 'duration'">
                <span v-if="ex.total_distance_meters">{{ formatDistance(ex.total_distance_meters) }}</span>
                <span v-if="ex.total_duration_seconds">{{ formatSetDuration(ex.total_duration_seconds) }}</span>
              </template>
              <template v-else>
                <span>1RM est. {{ ex.estimated_1rm ? parseFloat(ex.estimated_1rm).toFixed(1) + ' kg' : NO_VALUE }}</span>
                <span>{{ ex.total_volume ? ex.total_volume.toLocaleString('es-ES') + ' kg' : NO_VALUE }}</span>
              </template>
            </div>
          </li>
        </ul>
      </div>

      <div>
        <h4 class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-2">Mis notas</h4>
        <UiInput
          v-model="localNotes"
          type="textarea"
          :rows="3"
          placeholder="Fatiga, ajustes, sensaciones…"
        />
        <div class="mt-2 flex items-center gap-3">
          <UiButton
            size="sm"
            variant="secondary"
            :disabled="saveStatus === 'saving' || !isDirty"
            @click="saveNotes"
          >{{ saveStatus === 'saving' ? 'Guardando…' : 'Guardar notas' }}</UiButton>
          <!-- The confirmation names the same action as the button did. -->
          <span v-if="saveStatus === 'saved'" class="text-xs text-positive flex items-center gap-1">
            <span aria-hidden="true">✓</span>Guardado
          </span>
          <span v-if="saveStatus === 'error'" class="text-xs text-danger flex items-center gap-1">
            <span aria-hidden="true">⚠</span>No se pudo guardar. Inténtalo otra vez.
          </span>
        </div>
      </div>

      <div v-if="workout.description">
        <h4 class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-2">Notas de Hevy</h4>
        <p class="p-3 bg-surface-2 rounded-lg text-sm text-ink-2 whitespace-pre-wrap">{{ workout.description }}</p>
      </div>

      <div class="pt-4 border-t border-line">
        <UiButton :to="`/workouts/${workout.id}`" block>Ver detalle y análisis</UiButton>
      </div>
    </div>

    <UiEmptyState
      v-else
      class="flex-grow flex flex-col justify-center"
      title="Sin entreno este día"
      description="Día de descanso, o todavía sin sincronizar. Elige un día marcado para ver su detalle."
    />
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
