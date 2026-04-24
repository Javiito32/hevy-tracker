<template>
  <div class="max-w-5xl mx-auto">
    <NuxtLink to="/mesocycles" class="text-blue-600 hover:underline mb-4 inline-block">← Volver a Mesociclos</NuxtLink>

    <div v-if="pending" class="flex justify-center p-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-blue-500 border-t-transparent"></div>
    </div>

    <div v-else-if="mesocycle">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <h1 class="text-3xl font-bold text-gray-800">{{ mesocycle.name }}</h1>
            <span :class="statusBadge" class="text-xs font-semibold px-2.5 py-1 rounded-full capitalize">
              {{ statusLabel }}
            </span>
          </div>
          <p class="text-gray-500 text-sm">
            {{ formatDate(mesocycle.start_date) }}
            <span v-if="mesocycle.end_date"> → {{ formatDate(mesocycle.end_date) }}</span>
            <span v-else> → en curso</span>
            &bull; {{ mesocycle._count.workouts }} entrenamientos
          </p>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <button
            v-if="mesocycle.status !== 'active'"
            @click="changeStatus('active')"
            :disabled="statusChanging"
            class="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:opacity-50"
          >
            Activar
          </button>
          <button
            v-if="mesocycle.status === 'active'"
            @click="changeStatus('paused')"
            :disabled="statusChanging"
            class="px-4 py-2 bg-yellow-500 text-white text-sm rounded hover:bg-yellow-600 disabled:opacity-50"
          >
            Pausar
          </button>
          <button
            v-if="mesocycle.status !== 'completed'"
            @click="changeStatus('completed')"
            :disabled="statusChanging"
            class="px-4 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 disabled:opacity-50"
          >
            Completar
          </button>
          <button
            @click="openEdit"
            class="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
          >
            Editar
          </button>
          <NuxtLink
            :to="`/chat`"
            class="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700"
          >
            Hablar con IA
          </NuxtLink>
        </div>
      </div>

      <!-- Edit modal -->
      <div v-if="showEditModal" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
          <h2 class="text-lg font-bold text-gray-800 mb-5">Editar mesociclo</h2>
          <form @submit.prevent="saveMesocycle" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
              <input v-model="editForm.name" type="text" required class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Fecha inicio *</label>
                <input v-model="editForm.start_date" type="date" required class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
                <input v-model="editForm.end_date" type="date" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Objetivo</label>
              <textarea v-model="editForm.goal" rows="2" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="¿Qué quieres lograr en este mesociclo?"></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Split / Rutina</label>
              <textarea v-model="editForm.split_description" rows="3" class="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ej: Lun: Pecho/Tríceps&#10;Mar: Espalda/Bíceps&#10;..."></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Objetivo de entrenamientos/semana</label>
              <input v-model.number="editForm.target_volume_weekly" type="number" min="1" max="14" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Notas generales</label>
              <textarea v-model="editForm.notes" rows="2" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
            </div>
            <div class="flex justify-end gap-3 pt-2">
              <button type="button" @click="showEditModal = false" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
              <button type="submit" :disabled="savingEdit" class="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
                {{ savingEdit ? 'Guardando...' : 'Guardar cambios' }}
              </button>
            </div>
          </form>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left column: info + workouts list -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Stats row -->
          <div class="grid grid-cols-3 gap-4">
            <div class="bg-white rounded-lg shadow p-4 border-t-4 border-blue-500">
              <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Entrenamientos</p>
              <p class="text-2xl font-bold text-gray-800">{{ mesocycle._count.workouts }}</p>
            </div>
            <div class="bg-white rounded-lg shadow p-4 border-t-4 border-green-500">
              <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Volumen total</p>
              <p class="text-2xl font-bold text-gray-800">{{ totalVolume.toLocaleString() }}<span class="text-sm font-normal text-gray-500 ml-1">kg</span></p>
            </div>
            <div class="bg-white rounded-lg shadow p-4 border-t-4 border-purple-500">
              <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">RPE promedio</p>
              <p class="text-2xl font-bold text-gray-800">{{ avgRpe || 'N/A' }}</p>
            </div>
          </div>

          <!-- Workouts list -->
          <div class="bg-white rounded-lg shadow overflow-hidden">
            <div class="px-6 py-4 border-b border-gray-200">
              <h2 class="text-lg font-semibold text-gray-800">Entrenamientos</h2>
            </div>
            <div v-if="mesocycle.workouts.length === 0" class="p-6 text-gray-500 text-sm">
              No hay entrenamientos asignados a este mesociclo todavía.
            </div>
            <div v-else class="divide-y divide-gray-100">
              <NuxtLink
                v-for="workout in mesocycle.workouts"
                :key="workout.id"
                :to="`/workouts/${workout.id}`"
                class="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition"
              >
                <div>
                  <p class="font-medium text-gray-900">{{ workout.name }}</p>
                  <p class="text-sm text-gray-500">{{ formatDate(workout.date) }} &bull; {{ formatDuration(workout.duration) }}</p>
                </div>
                <div class="text-right text-sm text-gray-500">
                  <p v-if="workout.total_volume">{{ workout.total_volume.toLocaleString() }} kg</p>
                  <p v-if="workout.rpe_avg" class="text-xs">RPE {{ workout.rpe_avg }}</p>
                </div>
              </NuxtLink>
            </div>
          </div>
        </div>

        <!-- Right column: details panel -->
        <div class="space-y-6">
          <!-- Goal -->
          <div class="bg-white rounded-lg shadow p-6">
            <h2 class="text-base font-semibold text-gray-800 mb-3">Objetivo</h2>
            <p class="text-sm text-gray-700 whitespace-pre-wrap" v-if="mesocycle.goal">{{ mesocycle.goal }}</p>
            <p class="text-sm text-gray-400 italic" v-else>Sin objetivo definido.</p>
          </div>

          <!-- Split description -->
          <div class="bg-white rounded-lg shadow p-6">
            <h2 class="text-base font-semibold text-gray-800 mb-3">Split / Rutina</h2>
            <p class="text-sm text-gray-700 whitespace-pre-wrap font-mono" v-if="mesocycle.split_description">{{ mesocycle.split_description }}</p>
            <p class="text-sm text-gray-400 italic" v-else>Sin descripción de split.</p>
          </div>

          <!-- Notes -->
          <div class="bg-white rounded-lg shadow p-6" v-if="mesocycle.notes">
            <h2 class="text-base font-semibold text-gray-800 mb-3">Notas</h2>
            <p class="text-sm text-gray-700 whitespace-pre-wrap">{{ mesocycle.notes }}</p>
          </div>
        </div>
      </div>

      <!-- Evaluaciones semanales -->
      <div class="mt-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold text-gray-800">Evaluaciones semanales</h2>
          <button
            @click="triggerEvaluation"
            :disabled="evaluating"
            class="px-4 py-2 bg-purple-600 text-white text-sm rounded hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
          >
            <svg v-if="evaluating" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            {{ evaluating ? 'Generando...' : '✨ Evaluar semana actual' }}
          </button>
        </div>

        <div v-if="evalError" class="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded mb-4">
          {{ evalError }}
        </div>

        <div v-if="evalsLoading" class="text-center py-6 text-gray-400 text-sm">Cargando evaluaciones...</div>

        <div v-else-if="!evaluations?.length" class="bg-white rounded-lg shadow p-8 text-center text-gray-400">
          <p class="text-sm">Sin evaluaciones todavía. Genera la primera con el botón de arriba.</p>
        </div>

        <div v-else class="space-y-4">
          <div
            v-for="ev in evaluations"
            :key="ev.id"
            class="bg-white rounded-lg shadow overflow-hidden"
          >
            <div
              class="flex items-center justify-between px-6 py-3 bg-purple-50 border-b border-purple-100 cursor-pointer"
              @click="toggleEval(ev.id)"
            >
              <div class="flex items-center gap-3">
                <span class="bg-purple-600 text-white text-xs font-bold px-2 py-0.5 rounded">S{{ ev.week_number }}</span>
                <span class="text-sm font-medium text-gray-800">
                  {{ new Date(ev.evaluation_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) }}
                </span>
                <span
                  v-if="ev.volume_trend"
                  class="text-xs px-2 py-0.5 rounded-full"
                  :class="{
                    'bg-green-100 text-green-700': ev.volume_trend === 'increasing',
                    'bg-yellow-100 text-yellow-700': ev.volume_trend === 'stable',
                    'bg-red-100 text-red-700': ev.volume_trend === 'decreasing',
                    'bg-gray-100 text-gray-600': ev.volume_trend === 'N/A'
                  }"
                >
                  {{ ev.volume_trend === 'increasing' ? '↑ Volumen' : ev.volume_trend === 'decreasing' ? '↓ Volumen' : '→ Estable' }}
                </span>
              </div>
              <span class="text-gray-400 text-xs">{{ expandedEvals.has(ev.id) ? '▲' : '▼' }}</span>
            </div>

            <div v-if="expandedEvals.has(ev.id)" class="px-6 py-4">
              <div
                class="prose prose-sm text-gray-700 max-w-none"
                v-html="renderMarkdown(ev.ai_analysis ?? '')"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Diario de notas -->
      <div class="mt-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold text-gray-800">Diario</h2>
          <button
            @click="showNoteForm = !showNoteForm"
            class="px-4 py-2 bg-teal-600 text-white text-sm rounded hover:bg-teal-700 flex items-center gap-1.5"
          >
            <span>+ Añadir nota</span>
          </button>
        </div>

        <!-- Note form -->
        <div v-if="showNoteForm" class="bg-white rounded-lg shadow p-5 mb-4">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
            <div>
              <label class="block text-xs font-medium text-gray-600 mb-1">Fecha</label>
              <input v-model="noteForm.date" type="date" class="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-gray-600 mb-1">Etiquetas (separadas por coma)</label>
              <input v-model="noteForm.tagsRaw" type="text" placeholder="ej: fatiga, sueño, nutrición" class="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            </div>
          </div>
          <textarea
            v-model="noteForm.content"
            rows="3"
            placeholder="Sensaciones del entrenamiento, cambios en dieta, calidad del sueño, nivel de estrés..."
            class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 mb-3"
          ></textarea>
          <div class="flex justify-end gap-3">
            <button @click="showNoteForm = false; resetNoteForm()" class="text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
            <button @click="saveNote" :disabled="savingNote || !noteForm.content.trim()" class="px-4 py-1.5 bg-teal-600 text-white text-sm rounded hover:bg-teal-700 disabled:opacity-50">
              {{ savingNote ? 'Guardando...' : 'Guardar nota' }}
            </button>
          </div>
        </div>

        <div v-if="notesLoading" class="text-center py-6 text-gray-400 text-sm">Cargando notas...</div>

        <div v-else-if="!notes?.length" class="bg-white rounded-lg shadow p-8 text-center text-gray-400">
          <p class="text-sm">Sin notas todavía. Registra tus sensaciones, cambios en rutina o en dieta.</p>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="note in notes"
            :key="note.id"
            class="bg-white rounded-lg shadow px-5 py-4 flex gap-4"
          >
            <div class="flex-shrink-0 text-center">
              <p class="text-xs font-bold text-teal-700 uppercase">{{ noteDayMonth(note.date) }}</p>
              <p class="text-lg font-bold text-gray-800 leading-none">{{ noteDay(note.date) }}</p>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-gray-700 whitespace-pre-wrap">{{ note.content }}</p>
              <div v-if="noteTags(note.tags).length" class="flex flex-wrap gap-1 mt-2">
                <span
                  v-for="tag in noteTags(note.tags)"
                  :key="tag"
                  class="text-xs bg-teal-50 text-teal-700 border border-teal-100 px-2 py-0.5 rounded-full"
                >{{ tag }}</span>
              </div>
            </div>
            <button @click="deleteNote(note.id)" class="text-gray-300 hover:text-red-400 text-lg self-start flex-shrink-0">×</button>
          </div>
        </div>
      </div>

      <!-- Resumen final del mesociclo -->
      <div v-if="mesocycle.status === 'completed'" class="mt-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold text-gray-800">Resumen final</h2>
          <button
            v-if="!mesocycle.final_summary"
            @click="generateFinalSummary"
            :disabled="generatingSummary"
            class="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            <svg v-if="generatingSummary" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            {{ generatingSummary ? 'Generando...' : '✨ Generar resumen final' }}
          </button>
          <button
            v-else
            @click="generateFinalSummary"
            :disabled="generatingSummary"
            class="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            {{ generatingSummary ? 'Regenerando...' : 'Regenerar' }}
          </button>
        </div>

        <div v-if="summaryError" class="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded mb-4">
          {{ summaryError }}
        </div>

        <div v-if="mesocycle.final_summary" class="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-6">
          <div class="prose prose-sm text-gray-700 max-w-none" v-html="renderMarkdown(mesocycle.final_summary)"></div>
        </div>
        <div v-else-if="!generatingSummary" class="bg-white rounded-lg shadow p-8 text-center text-gray-400">
          <p class="text-sm">El resumen final se genera automáticamente al completar el mesociclo, o puedes generarlo manualmente con el botón de arriba.</p>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-12">
      <p class="text-gray-500">Mesociclo no encontrado.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const mesocycleId = route.params.id as string

const { data: mesocycle, pending, refresh } = useFetch(`/api/mesocycles/${mesocycleId}`)
const { data: evaluations, pending: evalsLoading, refresh: refreshEvals } = useFetch(`/api/mesocycles/${mesocycleId}/evaluations`)
const { data: notes, pending: notesLoading, refresh: refreshNotes } = useFetch(`/api/mesocycles/${mesocycleId}/notes`)

const statusChanging = ref(false)
const showEditModal = ref(false)
const savingEdit = ref(false)
const editForm = ref({ name: '', start_date: '', end_date: '', goal: '', split_description: '', target_volume_weekly: 4, notes: '' })

const openEdit = () => {
  const m = mesocycle.value as any
  editForm.value = {
    name: m.name ?? '',
    start_date: m.start_date ? m.start_date.slice(0, 10) : '',
    end_date: m.end_date ? m.end_date.slice(0, 10) : '',
    goal: m.goal ?? '',
    split_description: m.split_description ?? '',
    target_volume_weekly: m.target_volume_weekly ?? 4,
    notes: m.notes ?? ''
  }
  showEditModal.value = true
}

const saveMesocycle = async () => {
  savingEdit.value = true
  try {
    await $fetch(`/api/mesocycles/${mesocycleId}`, {
      method: 'PATCH',
      body: {
        ...editForm.value,
        end_date: editForm.value.end_date || null
      }
    })
    await refresh()
    showEditModal.value = false
  } finally {
    savingEdit.value = false
  }
}

const evaluating = ref(false)
const evalError = ref<string | null>(null)
const expandedEvals = ref(new Set<string>())
const showNoteForm = ref(false)
const savingNote = ref(false)
const noteForm = ref({ date: new Date().toISOString().slice(0, 10), content: '', tagsRaw: '' })
const generatingSummary = ref(false)
const summaryError = ref<string | null>(null)

const generateFinalSummary = async () => {
  generatingSummary.value = true
  summaryError.value = null
  try {
    await $fetch(`/api/mesocycles/${mesocycleId}/final-summary`, { method: 'POST' })
    await refresh()
  } catch (err: any) {
    summaryError.value = err?.data?.message ?? err?.message ?? 'Error al generar el resumen final.'
  } finally {
    generatingSummary.value = false
  }
}

const statusLabel = computed(() => {
  const map: Record<string, string> = { active: 'Activo', paused: 'Pausado', completed: 'Completado' }
  return map[mesocycle.value?.status ?? ''] ?? mesocycle.value?.status ?? ''
})

const statusBadge = computed(() => {
  const map: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    paused: 'bg-yellow-100 text-yellow-800',
    completed: 'bg-gray-100 text-gray-700'
  }
  return map[mesocycle.value?.status ?? ''] ?? 'bg-gray-100 text-gray-700'
})

const totalVolume = computed(() => {
  if (!mesocycle.value?.workouts) return 0
  return mesocycle.value.workouts.reduce((sum: number, w: any) => sum + (w.total_volume ?? 0), 0)
})

const avgRpe = computed(() => {
  if (!mesocycle.value?.workouts?.length) return null
  const workoutsWithRpe = mesocycle.value.workouts.filter((w: any) => w.rpe_avg)
  if (!workoutsWithRpe.length) return null
  const avg = workoutsWithRpe.reduce((sum: number, w: any) => sum + w.rpe_avg, 0) / workoutsWithRpe.length
  return avg.toFixed(1)
})

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return 'N/A'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const changeStatus = async (newStatus: string) => {
  statusChanging.value = true
  try {
    await $fetch(`/api/mesocycles/${mesocycleId}`, {
      method: 'PATCH',
      body: { status: newStatus }
    })
    await refresh()
  } finally {
    statusChanging.value = false
  }
}

const triggerEvaluation = async () => {
  evaluating.value = true
  evalError.value = null
  try {
    const result = await $fetch(`/api/mesocycles/${mesocycleId}/evaluate`, { method: 'POST' }) as any
    await refreshEvals()
    if (result?.id) {
      expandedEvals.value = new Set([result.id, ...expandedEvals.value])
    }
  } catch (err: any) {
    evalError.value = err?.data?.message ?? err?.message ?? 'Error al generar la evaluación.'
  } finally {
    evaluating.value = false
  }
}

const toggleEval = (id: string) => {
  const next = new Set(expandedEvals.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedEvals.value = next
}

const resetNoteForm = () => {
  noteForm.value = { date: new Date().toISOString().slice(0, 10), content: '', tagsRaw: '' }
}

const saveNote = async () => {
  if (!noteForm.value.content.trim()) return
  savingNote.value = true
  try {
    const tags = noteForm.value.tagsRaw
      ? noteForm.value.tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
      : []
    await $fetch(`/api/mesocycles/${mesocycleId}/notes`, {
      method: 'POST',
      body: { content: noteForm.value.content, date: noteForm.value.date, tags }
    })
    await refreshNotes()
    showNoteForm.value = false
    resetNoteForm()
  } finally {
    savingNote.value = false
  }
}

const deleteNote = async (noteId: string) => {
  if (!confirm('¿Eliminar esta nota?')) return
  await $fetch(`/api/mesocycles/${mesocycleId}/notes/${noteId}`, { method: 'DELETE' })
  await refreshNotes()
}

const noteTags = (tagsJson?: string | null): string[] => {
  if (!tagsJson) return []
  try { return JSON.parse(tagsJson) } catch { return [] }
}

const noteDay = (d: string) => new Date(d).getDate()
const noteDayMonth = (d: string) =>
  new Date(d).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')

const renderMarkdown = (text: string): string => {
  return text
    .replace(/^### (.+)$/gm, '<h3 class="font-semibold text-gray-800 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-bold text-gray-900 mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="font-bold text-lg text-gray-900 mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/\n\n/g, '</p><p class="mb-2">')
    .replace(/^(?!<[hlp]|<li)(.+)$/gm, '<p class="mb-2">$1</p>')
}
</script>
