<template>
  <div class="max-w-5xl mx-auto">
    <UiLink to="/calendar" class="text-sm mb-5 inline-block">← Volver al calendario</UiLink>

    <div v-if="pending" class="flex justify-center py-16 text-ink-3">
      <UiSpinner size="lg" />
    </div>

    <template v-else-if="workout">
      <UiPageHeader :title="workout.name" :subtitle="`${formattedDate} · ${formatDuration(workout.duration)}`">
        <template #actions>
          <span v-if="workout.ai_analysis" class="text-xs text-ink-3 hidden sm:inline">Ya analizado</span>
          <UiButton :loading="aiStatus === 'loading'" @click="analyzeWithAI">
            {{ aiStatus === 'loading' ? 'Analizando…' : workout.ai_analysis ? 'Volver a analizar' : 'Analizar con IA' }}
          </UiButton>
        </template>
      </UiPageHeader>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div class="lg:col-span-2">
          <UiCard eyebrow="Sesión" title="Ejercicios" flush>
            <!-- The legend only appears when the workout actually contains
                 marked sets, so it never explains symbols that aren't on screen. -->
            <template v-if="setTypeLegend.length" #actions>
              <div class="flex items-center gap-3 text-xs text-ink-3">
                <span v-for="entry in setTypeLegend" :key="entry.label" class="flex items-center gap-1.5">
                  <span class="inline-flex items-center justify-center min-w-[1.25rem] px-1 rounded font-data text-[10px] font-semibold" :class="entry.badge">{{ entry.mark }}</span>
                  {{ entry.label }}
                </span>
              </div>
            </template>

            <UiEmptyState
              v-if="!workout.exercises_summary || workout.exercises_summary.length === 0"
              title="Sin ejercicios registrados"
              description="Este entreno llegó desde Hevy sin series."
            />

            <div v-else class="divide-y divide-line">
              <div v-for="(exercise, exIndex) in workout.exercises_summary" :key="exIndex" class="p-5">
                <div class="flex justify-between items-start gap-3 mb-3 flex-wrap">
                  <div class="min-w-0">
                    <h3 class="text-sm font-medium text-ink">{{ exercise.name }}</h3>
                    <p class="font-data text-xs text-ink-3 mt-0.5">{{ describeSetCount(exercise.sets_details || []) }}</p>
                  </div>
                  <div class="font-data text-xs text-ink-3 flex gap-4">
                    <template v-if="getExerciseType(exercise) === 'strength'">
                      <span v-if="exercise.estimated_1rm">1RM <span class="text-ink-2">{{ parseFloat(exercise.estimated_1rm).toFixed(1) }} kg</span></span>
                      <span v-if="exercise.total_volume">Vol <span class="text-ink-2">{{ exercise.total_volume.toLocaleString('es-ES') }} kg</span></span>
                    </template>
                    <template v-else>
                      <span v-if="exercise.total_distance_meters">Dist <span class="text-ink-2">{{ formatDistance(exercise.total_distance_meters) }}</span></span>
                      <span v-if="exercise.total_duration_seconds">Tiempo <span class="text-ink-2">{{ formatSetDuration(exercise.total_duration_seconds) }}</span></span>
                    </template>
                  </div>
                </div>

                <div v-if="exercise.sets_details && exercise.sets_details.length > 0" class="bg-surface-2 border border-line rounded-lg overflow-hidden">
                  <template v-if="getExerciseType(exercise) === 'strength'">
                    <div class="grid grid-cols-4 gap-2 text-[10px] font-semibold text-ink-3 text-center py-2 uppercase tracking-wide border-b border-line">
                      <div>Set</div><div>kg</div><div>Reps</div><div>RPE</div>
                    </div>
                    <div v-for="({ set, marker, style }, setIndex) in numberSets(exercise.sets_details)" :key="setIndex"
                      class="grid grid-cols-4 gap-2 font-data text-sm text-center py-2 border-b border-line last:border-b-0"
                      :class="style.row">
                      <div>
                        <span class="inline-flex items-center justify-center min-w-[1.5rem] px-1 rounded font-data text-xs font-semibold" :class="style.badge" :title="style.label">{{ marker }}</span>
                      </div>
                      <div class="text-ink">{{ set.weight ?? '-' }}</div>
                      <div class="text-ink">{{ set.reps ?? '-' }}</div>
                      <div class="text-ink-3">{{ set.rpe || '-' }}</div>
                    </div>
                  </template>
                  <template v-else-if="getExerciseType(exercise) === 'cardio'">
                    <div class="grid grid-cols-4 gap-2 text-[10px] font-semibold text-ink-3 text-center py-2 uppercase tracking-wide border-b border-line">
                      <div>Set</div><div>Distancia</div><div>Tiempo</div><div>RPE</div>
                    </div>
                    <div v-for="({ set, marker, style }, setIndex) in numberSets(exercise.sets_details)" :key="setIndex"
                      class="grid grid-cols-4 gap-2 font-data text-sm text-center py-2 border-b border-line last:border-b-0"
                      :class="style.row">
                      <div>
                        <span class="inline-flex items-center justify-center min-w-[1.5rem] px-1 rounded font-data text-xs font-semibold" :class="style.badge" :title="style.label">{{ marker }}</span>
                      </div>
                      <div class="text-ink">{{ formatDistance(set.distance_meters) }}</div>
                      <div class="text-ink">{{ formatSetDuration(set.duration_seconds) }}</div>
                      <div class="text-ink-3">{{ set.rpe || '-' }}</div>
                    </div>
                  </template>
                  <template v-else>
                    <div class="grid grid-cols-3 gap-2 text-[10px] font-semibold text-ink-3 text-center py-2 uppercase tracking-wide border-b border-line">
                      <div>Set</div><div>Tiempo</div><div>RPE</div>
                    </div>
                    <div v-for="({ set, marker, style }, setIndex) in numberSets(exercise.sets_details)" :key="setIndex"
                      class="grid grid-cols-3 gap-2 font-data text-sm text-center py-2 border-b border-line last:border-b-0"
                      :class="style.row">
                      <div>
                        <span class="inline-flex items-center justify-center min-w-[1.5rem] px-1 rounded font-data text-xs font-semibold" :class="style.badge" :title="style.label">{{ marker }}</span>
                      </div>
                      <div class="text-ink">{{ formatSetDuration(set.duration_seconds) }}</div>
                      <div class="text-ink-3">{{ set.rpe || '-' }}</div>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </UiCard>
        </div>

        <div class="space-y-4">
          <UiCard
            v-if="displayedAnalysis || aiStatus === 'error'"
            eyebrow="Coach"
            :title="aiStatus === 'error' ? 'No se pudo analizar' : 'Análisis'"
            :class="aiStatus === 'error' && 'border-danger/40'"
          >
            <p v-if="aiStatus === 'error'" class="text-sm text-danger flex items-start gap-2">
              <span aria-hidden="true">⚠</span>{{ aiError }}
            </p>
            <div v-else class="md" v-html="renderMarkdown(displayedAnalysis)" />
            <p v-if="isAdmin && displayedModel" class="font-data text-[10px] text-ink-3 mt-3">Modelo: {{ displayedModel }}</p>

            <template #footer>
              <UiLink :to="{ path: '/chat', query: { context: 'workout', name: workout.name } }">Continuar en el chat →</UiLink>
            </template>
          </UiCard>

          <UiCard eyebrow="Resumen" title="Estadísticas">
            <div class="space-y-4">
              <UiStat label="Volumen total" :value="workout.total_volume ?? null" unit="kg" />
              <UiStat label="Ejercicios" :value="workout.exercises_summary?.length ?? 0" />
              <UiStat label="RPE promedio" :value="workout.rpe_avg ?? null" :decimals="1" />
            </div>
          </UiCard>

          <UiCard eyebrow="Tuyo" title="Mis notas">
            <template v-if="!editingNotes" #actions>
              <UiButton size="sm" variant="ghost" @click="startEditNotes">Editar</UiButton>
            </template>

            <template v-if="editingNotes">
              <UiInput
                v-model="localNotes"
                type="textarea"
                :rows="4"
                placeholder="Fatiga, ajustes, sensaciones…"
                autofocus
              />
              <div class="mt-2 flex items-center gap-2 flex-wrap">
                <UiButton size="sm" :loading="notesSaveStatus === 'saving'" @click="saveNotes">
                  {{ notesSaveStatus === 'saving' ? 'Guardando…' : 'Guardar notas' }}
                </UiButton>
                <UiButton size="sm" variant="ghost" @click="cancelEditNotes">Cancelar</UiButton>
                <span v-if="notesSaveStatus === 'error'" class="text-xs text-danger flex items-center gap-1">
                  <span aria-hidden="true">⚠</span>No se pudo guardar.
                </span>
              </div>
            </template>
            <p v-else-if="localNotes" class="p-3 bg-surface-2 rounded-lg text-sm text-ink-2 whitespace-pre-wrap">{{ localNotes }}</p>
            <p v-else class="text-sm text-ink-3">Sin notas todavía.</p>
          </UiCard>

          <UiCard v-if="workout.description" eyebrow="Hevy" title="Notas de la sesión">
            <p class="p-3 bg-surface-2 rounded-lg text-sm text-ink-2 whitespace-pre-wrap">{{ workout.description }}</p>
          </UiCard>
        </div>
      </div>
    </template>

    <UiCard v-else flush>
      <UiEmptyState
        title="Entrenamiento no encontrado"
        description="Puede que se borrara en Hevy y ya no esté sincronizado."
        action="Volver al calendario"
        to="/calendar"
      />
    </UiCard>
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
  return new Date(dateStr).toLocaleString('es-ES', {
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
