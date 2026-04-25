<template>
  <div class="max-w-5xl mx-auto">
    <NuxtLink to="/mesocycles" class="text-indigo-400 hover:text-indigo-300 mb-4 inline-block transition">← Volver a Mesociclos</NuxtLink>

    <div v-if="pending" class="flex justify-center p-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent"></div>
    </div>

    <div v-else-if="mesocycle">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <h1 class="text-3xl font-bold text-slate-100">{{ mesocycle.name }}</h1>
            <span :class="statusBadge" class="text-xs font-semibold px-2.5 py-1 rounded-full capitalize">
              {{ statusLabel }}
            </span>
          </div>
          <p class="text-slate-500 text-sm">
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
            class="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition"
          >
            Activar
          </button>
          <button
            v-if="mesocycle.status === 'active'"
            @click="changeStatus('paused')"
            :disabled="statusChanging"
            class="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-500 disabled:opacity-50 transition"
          >
            Pausar
          </button>
          <button
            v-if="mesocycle.status !== 'completed'"
            @click="changeStatus('completed')"
            :disabled="statusChanging"
            class="px-4 py-2 bg-slate-700 text-slate-200 text-sm rounded-lg hover:bg-slate-600 disabled:opacity-50 transition"
          >
            Completar
          </button>
          <button
            @click="openEdit"
            class="px-4 py-2 bg-slate-800 border border-slate-700 text-slate-300 text-sm rounded-lg hover:bg-slate-700 transition"
          >
            Editar
          </button>
          <NuxtLink
            :to="`/chat`"
            class="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-500 transition"
          >
            Hablar con IA
          </NuxtLink>
        </div>
      </div>

      <!-- Edit modal -->
      <div v-if="showEditModal" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div class="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
          <h2 class="text-lg font-bold text-slate-100 mb-5">Editar mesociclo</h2>
          <form @submit.prevent="saveMesocycle" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-slate-400 mb-1.5">Nombre *</label>
              <input v-model="editForm.name" type="text" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-slate-400 mb-1.5">Fecha inicio *</label>
                <input v-model="editForm.start_date" type="date" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-400 mb-1.5">Fecha fin</label>
                <input v-model="editForm.end_date" type="date" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-400 mb-1.5">Objetivo</label>
              <textarea v-model="editForm.goal" rows="2" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" placeholder="¿Qué quieres lograr en este mesociclo?"></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-400 mb-1.5">Split / Rutina</label>
              <textarea v-model="editForm.split_description" rows="3" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" placeholder="Ej: Lun: Pecho/Tríceps&#10;Mar: Espalda/Bíceps&#10;..."></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-400 mb-1.5">Objetivo de entrenamientos/semana</label>
              <input v-model.number="editForm.target_volume_weekly" type="number" min="1" max="14" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-400 mb-1.5">Notas generales</label>
              <textarea v-model="editForm.notes" rows="2" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"></textarea>
            </div>
            <div class="flex justify-end gap-3 pt-2">
              <button type="button" @click="showEditModal = false" class="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition">Cancelar</button>
              <button type="submit" :disabled="savingEdit" class="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-500 disabled:opacity-50 transition">
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
            <div class="bg-slate-900 rounded-xl border border-slate-800 border-t-4 border-t-indigo-500 p-4">
              <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Entrenamientos</p>
              <p class="text-2xl font-bold text-slate-100">{{ mesocycle._count.workouts }}</p>
            </div>
            <div class="bg-slate-900 rounded-xl border border-slate-800 border-t-4 border-t-emerald-500 p-4">
              <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Volumen total</p>
              <p class="text-2xl font-bold text-slate-100">{{ totalVolume.toLocaleString() }}<span class="text-sm font-normal text-slate-500 ml-1">kg</span></p>
            </div>
            <div class="bg-slate-900 rounded-xl border border-slate-800 border-t-4 border-t-violet-500 p-4">
              <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">RPE promedio</p>
              <p class="text-2xl font-bold text-slate-100">{{ avgRpe || 'N/A' }}</p>
            </div>
          </div>

          <!-- Workouts list -->
          <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-800">
              <h2 class="text-lg font-semibold text-slate-200">Entrenamientos</h2>
            </div>
            <div v-if="mesocycle.workouts.length === 0" class="p-6 text-slate-500 text-sm">
              No hay entrenamientos asignados a este mesociclo todavía.
            </div>
            <div v-else class="divide-y divide-slate-800">
              <NuxtLink
                v-for="workout in mesocycle.workouts"
                :key="workout.id"
                :to="`/workouts/${workout.id}`"
                class="flex items-center justify-between px-6 py-4 hover:bg-slate-800/50 transition"
              >
                <div>
                  <p class="font-medium text-slate-200">{{ workout.name }}</p>
                  <p class="text-sm text-slate-500">{{ formatDate(workout.date) }} &bull; {{ formatDuration(workout.duration) }}</p>
                </div>
                <div class="text-right text-sm text-slate-500">
                  <p v-if="workout.total_volume">{{ workout.total_volume.toLocaleString() }} kg</p>
                  <p v-if="workout.rpe_avg" class="text-xs">RPE {{ workout.rpe_avg }}</p>
                </div>
              </NuxtLink>
            </div>
          </div>
        </div>

        <!-- Right column: details panel -->
        <div class="space-y-6">
          <div class="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Objetivo</h2>
            <p class="text-sm text-slate-300 whitespace-pre-wrap" v-if="mesocycle.goal">{{ mesocycle.goal }}</p>
            <p class="text-sm text-slate-600 italic" v-else>Sin objetivo definido.</p>
          </div>

          <div class="bg-slate-900 rounded-xl border border-slate-800 p-6">
            <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Split / Rutina</h2>
            <p class="text-sm text-slate-300 whitespace-pre-wrap font-mono" v-if="mesocycle.split_description">{{ mesocycle.split_description }}</p>
            <p class="text-sm text-slate-600 italic" v-else>Sin descripción de split.</p>
          </div>

          <div class="bg-slate-900 rounded-xl border border-slate-800 p-6" v-if="mesocycle.notes">
            <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Notas</h2>
            <p class="text-sm text-slate-300 whitespace-pre-wrap">{{ mesocycle.notes }}</p>
          </div>
        </div>
      </div>

      <!-- Evaluaciones semanales -->
      <div class="mt-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold text-slate-100">Evaluaciones semanales</h2>
          <button
            @click="triggerEvaluation"
            :disabled="evaluating"
            class="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-500 disabled:opacity-50 flex items-center gap-2 transition"
          >
            <svg v-if="evaluating" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            {{ evaluating ? 'Generando...' : '✨ Evaluar semana actual' }}
          </button>
        </div>

        <div v-if="evalError" class="bg-rose-950/60 border border-rose-800 text-rose-400 text-sm px-4 py-3 rounded-lg mb-4">
          {{ evalError }}
        </div>

        <div v-if="evalsLoading" class="text-center py-6 text-slate-500 text-sm">Cargando evaluaciones...</div>

        <div v-else-if="!evaluations?.length" class="bg-slate-900 rounded-xl border border-slate-800 p-8 text-center text-slate-500">
          <p class="text-sm">Sin evaluaciones todavía. Genera la primera con el botón de arriba.</p>
        </div>

        <div v-else class="space-y-4">
          <div
            v-for="ev in evaluations"
            :key="ev.id"
            class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden"
          >
            <div
              class="flex items-center justify-between px-6 py-3 bg-violet-950/30 border-b border-violet-900 cursor-pointer"
              @click="toggleEval(ev.id)"
            >
              <div class="flex items-center gap-3">
                <span class="bg-violet-600 text-white text-xs font-bold px-2 py-0.5 rounded">S{{ ev.week_number }}</span>
                <span class="text-sm font-medium text-slate-300">
                  {{ new Date(ev.evaluation_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) }}
                </span>
                <span
                  v-if="ev.volume_trend"
                  class="text-xs px-2 py-0.5 rounded-full"
                  :class="{
                    'bg-emerald-950/60 text-emerald-400': ev.volume_trend === 'increasing',
                    'bg-amber-950/60 text-amber-400': ev.volume_trend === 'stable',
                    'bg-rose-950/60 text-rose-400': ev.volume_trend === 'decreasing',
                    'bg-slate-800 text-slate-500': ev.volume_trend === 'N/A'
                  }"
                >
                  {{ ev.volume_trend === 'increasing' ? '↑ Volumen' : ev.volume_trend === 'decreasing' ? '↓ Volumen' : '→ Estable' }}
                </span>
              </div>
              <span class="text-slate-500 text-xs">{{ expandedEvals.has(ev.id) ? '▲' : '▼' }}</span>
            </div>

            <div v-if="expandedEvals.has(ev.id)" class="px-6 py-4">
              <div
                class="prose prose-sm prose-invert text-slate-300 max-w-none"
                v-html="renderMarkdown(ev.ai_analysis ?? '')"
              ></div>
              <p v-if="isAdmin && (ev as any).ai_model" class="text-[10px] font-mono text-slate-600 mt-2">Modelo: {{ (ev as any).ai_model }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Diario de notas -->
      <div class="mt-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold text-slate-100">Diario</h2>
          <button
            @click="showNoteForm = !showNoteForm"
            class="px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 flex items-center gap-1.5 transition"
          >
            <span>+ Añadir nota</span>
          </button>
        </div>

        <!-- Note form -->
        <div v-if="showNoteForm" class="bg-slate-900 rounded-xl border border-slate-800 p-5 mb-4">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
            <div>
              <label class="block text-xs font-medium text-slate-500 mb-1">Fecha</label>
              <input v-model="noteForm.date" type="date" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition" />
            </div>
            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-slate-500 mb-1">Etiquetas (separadas por coma)</label>
              <input v-model="noteForm.tagsRaw" type="text" placeholder="ej: fatiga, sueño, nutrición" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition" />
            </div>
          </div>
          <textarea
            v-model="noteForm.content"
            rows="3"
            placeholder="Sensaciones del entrenamiento, cambios en dieta, calidad del sueño, nivel de estrés..."
            class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent mb-3 transition"
          ></textarea>
          <div class="flex justify-end gap-3">
            <button @click="showNoteForm = false; resetNoteForm()" class="text-sm text-slate-500 hover:text-slate-300 transition">Cancelar</button>
            <button @click="saveNote" :disabled="savingNote || !noteForm.content.trim()" class="px-4 py-1.5 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-500 disabled:opacity-50 transition">
              {{ savingNote ? 'Guardando...' : 'Guardar nota' }}
            </button>
          </div>
        </div>

        <div v-if="notesLoading" class="text-center py-6 text-slate-500 text-sm">Cargando notas...</div>

        <div v-else-if="!notes?.length" class="bg-slate-900 rounded-xl border border-slate-800 p-8 text-center text-slate-500">
          <p class="text-sm">Sin notas todavía. Registra tus sensaciones, cambios en rutina o en dieta.</p>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="note in notes"
            :key="note.id"
            class="bg-slate-900 rounded-xl border border-slate-800 px-5 py-4 flex gap-4"
          >
            <div class="flex-shrink-0 text-center">
              <p class="text-xs font-bold text-teal-400 uppercase">{{ noteDayMonth(note.date) }}</p>
              <p class="text-lg font-bold text-slate-200 leading-none">{{ noteDay(note.date) }}</p>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-slate-300 whitespace-pre-wrap">{{ note.content }}</p>
              <div v-if="noteTags(note.tags).length" class="flex flex-wrap gap-1 mt-2">
                <span
                  v-for="tag in noteTags(note.tags)"
                  :key="tag"
                  class="text-xs bg-teal-950/60 text-teal-400 border border-teal-900 px-2 py-0.5 rounded-full"
                >{{ tag }}</span>
              </div>
            </div>
            <button @click="deleteNote(note.id)" class="text-slate-600 hover:text-rose-400 text-lg self-start flex-shrink-0 transition">×</button>
          </div>
        </div>
      </div>

      <!-- Resumen final del mesociclo -->
      <div v-if="mesocycle.status === 'completed'" class="mt-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold text-slate-100">Resumen final</h2>
          <button
            v-if="!mesocycle.final_summary"
            @click="generateFinalSummary"
            :disabled="generatingSummary"
            class="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2 transition"
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
            class="text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50 transition"
          >
            {{ generatingSummary ? 'Regenerando...' : 'Regenerar' }}
          </button>
        </div>

        <div v-if="summaryError" class="bg-rose-950/60 border border-rose-800 text-rose-400 text-sm px-4 py-3 rounded-lg mb-4">
          {{ summaryError }}
        </div>

        <div v-if="mesocycle.final_summary" class="bg-indigo-950/30 border border-indigo-900 rounded-xl p-6">
          <div class="prose prose-sm prose-invert text-slate-300 max-w-none" v-html="renderMarkdown(mesocycle.final_summary)"></div>
          <p v-if="isAdmin && displayedSummaryModel" class="text-[10px] font-mono text-slate-600 mt-2">Modelo: {{ displayedSummaryModel }}</p>
        </div>
        <div v-else-if="!generatingSummary" class="bg-slate-900 rounded-xl border border-slate-800 p-8 text-center text-slate-500">
          <p class="text-sm">El resumen final se genera automáticamente al completar el mesociclo, o puedes generarlo manualmente con el botón de arriba.</p>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-12">
      <p class="text-slate-500">Mesociclo no encontrado.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const mesocycleId = route.params.id as string

const { session } = useUserSession()
const isAdmin = computed(() => (session.value?.user as any)?.role === 'admin')

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
const freshSummaryModel = ref('')
const displayedSummaryModel = computed(() =>
  freshSummaryModel.value || (mesocycle.value as any)?.final_summary_model || ''
)

const generateFinalSummary = async () => {
  generatingSummary.value = true
  summaryError.value = null
  try {
    const res = await $fetch<{ success: boolean; final_summary: string; model: string }>(`/api/mesocycles/${mesocycleId}/final-summary`, { method: 'POST' })
    freshSummaryModel.value = res.model ?? ''
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
    active: 'bg-emerald-950/60 text-emerald-400',
    paused: 'bg-amber-950/60 text-amber-400',
    completed: 'bg-slate-800 text-slate-400'
  }
  return map[mesocycle.value?.status ?? ''] ?? 'bg-slate-800 text-slate-400'
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
    .replace(/^### (.+)$/gm, '<h3 class="font-semibold text-slate-200 mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-bold text-slate-100 mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="font-bold text-lg text-slate-100 mt-4 mb-2">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/\n\n/g, '</p><p class="mb-2">')
    .replace(/^(?!<[hlp]|<li)(.+)$/gm, '<p class="mb-2">$1</p>')
}
</script>
