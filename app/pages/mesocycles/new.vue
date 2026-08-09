<template>
  <div class="max-w-3xl mx-auto">
    <div class="mb-6 flex items-center">
      <NuxtLink to="/mesocycles" class="text-ink-3 hover:text-ink mr-4 transition">← Volver</NuxtLink>
      <h1 class="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] text-ink leading-none">Crear Mesociclo</h1>
    </div>

    <!-- AI Generation Panel -->
    <div class="bg-surface-2 border border-line rounded-card p-5 mb-6">
      <div class="flex items-center gap-2 mb-4">
        <svg class="w-5 h-5 text-ink-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
        <h2 class="font-semibold text-ink">Generar plan con IA</h2>
        <span class="text-xs text-ink-3 hidden sm:inline">— Describe tu objetivo y la IA rellena el formulario</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div class="sm:col-span-3">
          <input
            v-model="aiGoal"
            type="text"
            placeholder="Objetivo principal (ej. hipertrofia máxima, ganar fuerza en sentadilla...)"
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"
          />
        </div>
        <div>
          <label class="block text-xs text-ink-3 mb-1">Días/semana</label>
          <input v-model.number="aiDays" type="number" min="1" max="7" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
        </div>
        <div>
          <label class="block text-xs text-ink-3 mb-1">Duración (semanas)</label>
          <input v-model.number="aiWeeks" type="number" min="2" max="24" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
        </div>
        <div>
          <label class="block text-xs text-ink-3 mb-1">Equipamiento (opcional)</label>
          <input v-model="aiEquipment" type="text" placeholder="ej. gimnasio completo..." class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button
          @click="generateWithAI"
          :disabled="!aiGoal || !aiDays || !aiWeeks || generating"
          class="flex items-center gap-2 px-4 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 disabled:opacity-50 transition"
        >
          <svg v-if="generating" class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
          </svg>
          {{ generating ? 'Generando...' : 'Generar plan' }}
        </button>
        <span v-if="generating && generateStatus" class="text-xs text-ink-3">{{ generateStatus }}</span>
      </div>
      <p v-if="generating" class="text-xs text-ink-3 mt-2">
        Puede tardar un par de minutos. Mantén esta pestaña abierta.
      </p>
      <p v-if="generateError" class="text-sm text-danger mt-3">{{ generateError }}</p>
      <p v-if="generateWarning" class="text-sm text-warn mt-3">{{ generateWarning }}</p>
    </div>

    <!-- Main Form -->
    <div class="bg-surface rounded-card border border-line p-6">
      <form @submit.prevent="handleSubmit" class="space-y-6">
        <div>
          <label class="block text-sm font-medium text-ink-2 mb-1.5">Nombre *</label>
          <input
            v-model="form.name"
            type="text"
            placeholder="ej. Winter Hypertrophy Block v1"
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"
            required
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-ink-2 mb-1.5">Fecha de inicio *</label>
            <input
              v-model="form.start_date"
              type="date"
              class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"
              required
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-2 mb-1.5">Fecha de fin (Opcional)</label>
            <input
              v-model="form.end_date"
              type="date"
              class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-ink-2 mb-1.5">Objetivo</label>
          <textarea
            v-model="form.goal"
            rows="2"
            placeholder="Definición general de lo que quieres lograr"
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"
          ></textarea>
        </div>

        <div>
          <label class="block text-sm font-medium text-ink-2 mb-1.5">Split / Descripción de rutina</label>
          <textarea
            v-model="form.split_description"
            rows="8"
            placeholder="Describe tu split en formato narrativo... ej. Lunes - Pecho & Tríceps..."
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"
          ></textarea>
          <p class="text-xs text-ink-3 mt-1">La IA utilizará esto para entender tu contexto de entrenamiento.</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-ink-2 mb-1.5">Objetivo de entrenamientos por semana</label>
          <input
            v-model.number="form.target_sessions_weekly"
            type="number"
            min="1"
            max="14"
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"
          />
          <p class="text-xs text-ink-3 mt-1">Se usa en el dashboard para mostrar tu progreso semanal.</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-ink-2 mb-1.5">Notas adicionales</label>
          <textarea
            v-model="form.notes"
            rows="2"
            placeholder="Cualquier nota adicional sobre este bloque..."
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"
          ></textarea>
        </div>

        <!-- AI Feedback Section -->
        <div class="pt-4 border-t border-line">
          <div class="flex items-center gap-3">
            <button
              type="button"
              @click="analyzeWithAI"
              :disabled="!hasEnoughData || analyzingFeedback"
              class="flex items-center gap-2 text-sm px-3 py-1.5 border border-line-strong text-ink-2 rounded-lg hover:bg-surface-2 disabled:opacity-40 transition"
            >
              <svg v-if="analyzingFeedback" class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ analyzingFeedback ? 'Analizando...' : 'Analizar plan con IA' }}
            </button>
            <span v-if="!hasEnoughData" class="text-xs text-ink-3">Rellena al menos el objetivo y el split para analizar.</span>
          </div>

          <div v-if="aiFeedback" class="mt-4 bg-surface-2 border border-line rounded-card p-4">
            <div class="flex items-center justify-between mb-3">
              <span class="font-display text-sm font-semibold tracking-tight text-ink">Análisis de la IA</span>
              <button type="button" @click="aiFeedback = ''" class="text-xs text-ink-3 hover:text-ink">✕ Cerrar</button>
            </div>
            <div class="md" v-html="renderMarkdown(aiFeedback)"></div>
            <p v-if="isAdmin && feedbackModel" class="text-[10px] font-mono text-ink-3 mt-2">Modelo: {{ feedbackModel }}</p>
          </div>
          <p v-if="feedbackError" class="text-xs text-danger mt-2">{{ feedbackError }}</p>
        </div>

        <div v-if="error" class="bg-danger/10 border border-danger/40 text-danger px-4 py-3 rounded-lg text-sm">
          {{ error }}
        </div>

        <div class="flex justify-end space-x-3 pt-4 border-t border-line">
          <NuxtLink to="/mesocycles" class="px-4 py-2 border border-line-strong rounded-lg text-ink-2 hover:bg-surface-2 transition text-sm">
            Cancelar
          </NuxtLink>
          <button
            type="submit"
            :disabled="saving"
            class="px-4 py-2 bg-accent text-accent-ink rounded-lg hover:opacity-85 disabled:opacity-50 flex items-center text-sm transition"
          >
            <svg v-if="saving" class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {{ saving ? 'Guardando...' : 'Guardar Mesociclo' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const today = new Date().toISOString().split('T')[0]

const { session } = useUserSession()
const isAdmin = computed(() => (session.value?.user as any)?.role === 'admin')

const form = ref({
  name: '',
  start_date: today,
  end_date: '',
  goal: '',
  split_description: '',
  target_sessions_weekly: 4,
  notes: ''
})

const saving = ref(false)
const error = ref('')

const aiGoal = ref('')
const aiDays = ref(4)
const aiWeeks = ref(8)
const aiEquipment = ref('')
const generating = ref(false)
const generateError = ref('')
/** Kept apart from the error: a plan with unresolved ids is still a usable plan. */
const generateWarning = ref('')
/** Live step reported by the job — a minutes-long wait needs to show a pulse. */
const generateStatus = ref('')

const toast = useToast()

const analyzingFeedback = ref(false)
const aiFeedback = ref('')
const feedbackModel = ref('')
const feedbackError = ref('')

const hasEnoughData = computed(() => !!(form.value.goal && form.value.split_description))

/**
 * The structured plan the AI produced, held until the mesocycle exists.
 *
 * Sessions and exercises hang off a mesocycle id, so they can only be written
 * after the block is created — the generator runs before that.
 */
const generatedPlan = ref<{ sessions: any[]; weeks: any[] } | null>(null)

const POLL_MS = 2000
const POLL_TIMEOUT_MS = 6 * 60 * 1000

/**
 * Waits for a generation job, polling until it finishes.
 *
 * The work outlasts an HTTP request by minutes, so the request that starts it
 * returns a job id and this reads the result off the job row. Capped so a job
 * the server lost (a restart mid-generation leaves its row `running` forever)
 * eventually reports something instead of spinning until the tab is closed.
 */
const pollGeneration = async (jobId: string) => {
  const deadline = Date.now() + POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_MS))

    const job = await $fetch<{
      status: string; message: string | null; error: string | null
      plan: any; warning: string | null; finished: boolean
    }>(`/api/mesocycles/ai-generate/${jobId}`)

    if (job.message) generateStatus.value = job.message
    if (!job.finished) continue
    if (job.status === 'error') throw new Error(job.error || 'La generación falló.')
    return { plan: job.plan, warning: job.warning ?? undefined }
  }

  // Flagged so the caller keeps the job id: the generation is probably still
  // running, and reissuing it would pay for the same plan twice.
  throw Object.assign(
    new Error('La generación sigue en curso y está tardando más de lo normal. Recarga la página en un minuto para recoger el resultado.'),
    { keepJob: true }
  )
}

/**
 * The job currently in flight, remembered across a reload.
 *
 * A generation costs real money and runs for minutes on the server whether or
 * not anyone is watching. Losing the id — a refresh, a poll that gave up — used
 * to mean the plan was produced, paid for and discarded.
 */
const RESUME_KEY = 'mesocycle-generation-job'

const applyPlan = (result: { plan: any; warning?: string }) => {
  const plan = result.plan ?? {}
  if (plan.name) form.value.name = plan.name
  if (plan.goal) form.value.goal = plan.goal
  if (plan.notes) form.value.notes = plan.notes

  if (Array.isArray(plan.sessions) && plan.sessions.length) {
    generatedPlan.value = { sessions: plan.sessions, weeks: plan.weeks ?? [] }
    form.value.target_sessions_weekly = plan.sessions.length
    // Preview only — savePlan() regenerates this from the stored structure,
    // which is the copy that stays authoritative.
    form.value.split_description = plan.sessions.map((s: any) => {
      const day = s.day_of_week ? `${DAY_NAMES[s.day_of_week]}: ` : ''
      const lines = (s.exercises ?? []).map((e: any) => {
        const reps = e.rep_min && e.rep_max
          ? (e.rep_min === e.rep_max ? e.rep_min : `${e.rep_min}-${e.rep_max}`)
          : '?'
        return `  · ${e.name} — ${e.target_sets}×${reps}${e.target_rir != null ? ` @${e.target_rir} RIR` : ''}`
      })
      return `${day}${s.name}\n${lines.join('\n')}`
    }).join('\n\n')
  } else if (plan.split_description) {
    // Older shape, or a model that ignored the structure. Still usable as prose.
    generatedPlan.value = null
    form.value.split_description = plan.split_description
  } else {
    // The server rejects an empty plan, so this is unreachable through it —
    // but a response that changes no field and says nothing is the one outcome
    // the user cannot tell apart from a dead button, so it never ships silent.
    throw new Error('La IA no devolvió ninguna sesión de entrenamiento.')
  }

  generateWarning.value = result.warning ?? ''

  // Taken from the plan the model actually returned, not from the form field:
  // on a resumed generation the field holds its default, not what was asked for.
  const weeks = Array.isArray(plan.weeks) && plan.weeks.length ? plan.weeks.length : aiWeeks.value
  const end = new Date(form.value.start_date)
  end.setDate(end.getDate() + weeks * 7)
  form.value.end_date = end.toISOString().split('T')[0]
}

/** Shared by a fresh generation and by one resumed after a reload. */
const consumeGeneration = async (jobId: string) => {
  generating.value = true
  generateError.value = ''
  generateWarning.value = ''
  try {
    sessionStorage.setItem(RESUME_KEY, jobId)
    const result = await pollGeneration(jobId)
    applyPlan(result)
    sessionStorage.removeItem(RESUME_KEY)
    toast.success('Plan generado. Revísalo antes de guardar.')
  } catch (err: any) {
    generateError.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Error al generar el plan.'
    // Also as a toast: the inline note sits below a button the user is no longer
    // looking at after a generation that can take a minute.
    toast.error(generateError.value)
    // The id is kept on a timeout — the job may still be running, and it is the
    // only handle on work already paid for. A job that reported an error is done
    // and has nothing left to collect.
    if (!err?.keepJob) sessionStorage.removeItem(RESUME_KEY)
  } finally {
    generating.value = false
    generateStatus.value = ''
  }
}

const generateWithAI = async () => {
  generating.value = true
  generateError.value = ''
  generateWarning.value = ''
  generateStatus.value = 'Iniciando…'
  try {
    const started = await $fetch<{ jobId: string }>('/api/mesocycles/ai-generate', {
      method: 'POST',
      body: {
        goal: aiGoal.value,
        days_per_week: aiDays.value,
        duration_weeks: aiWeeks.value,
        equipment: aiEquipment.value || undefined
      }
    })
    await consumeGeneration(started.jobId)
  } catch (err: any) {
    generateError.value = err?.data?.statusMessage || err?.data?.message || err?.message || 'Error al generar el plan.'
    toast.error(generateError.value)
    generating.value = false
    generateStatus.value = ''
  }
}

// A generation left running by a reload is picked back up rather than reissued.
onMounted(() => {
  const jobId = sessionStorage.getItem(RESUME_KEY)
  if (jobId) {
    generateStatus.value = 'Retomando la generación en curso…'
    void consumeGeneration(jobId)
  }
})

const DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

const analyzeWithAI = async () => {
  analyzingFeedback.value = true
  feedbackError.value = ''
  aiFeedback.value = ''
  try {
    const durationWeeks = form.value.end_date
      ? Math.round((new Date(form.value.end_date).getTime() - new Date(form.value.start_date).getTime()) / (7 * 24 * 60 * 60 * 1000))
      : undefined
    const result = await $fetch<{ feedback: string; model: string }>('/api/mesocycles/ai-feedback', {
      method: 'POST',
      body: {
        name: form.value.name,
        goal: form.value.goal,
        split_description: form.value.split_description,
        target_sessions_weekly: form.value.target_sessions_weekly,
        duration_weeks: durationWeeks,
        notes: form.value.notes
      }
    })
    aiFeedback.value = result.feedback
    feedbackModel.value = result.model ?? ''
  } catch (err: any) {
    feedbackError.value = err?.data?.statusMessage || 'Error al analizar el plan.'
  } finally {
    analyzingFeedback.value = false
  }
}

// renderMarkdown comes from app/utils/markdown.ts (auto-imported).

const handleSubmit = async () => {
  error.value = ''
  saving.value = true
  try {
    const created = await $fetch<{ id: string }>('/api/mesocycles', {
      method: 'POST',
      body: {
        name: form.value.name,
        start_date: form.value.start_date,
        end_date: form.value.end_date || null,
        goal: form.value.goal,
        split_description: form.value.split_description,
        target_sessions_weekly: form.value.target_sessions_weekly,
        notes: form.value.notes
      }
    })

    // The structured plan needs the mesocycle to exist first. If this fails the
    // block is still created — the user keeps the prose split and can retry the
    // structure, rather than losing everything they just filled in.
    if (generatedPlan.value && created?.id) {
      try {
        await $fetch(`/api/mesocycles/${created.id}/plan`, {
          method: 'PUT',
          body: generatedPlan.value
        })
      } catch {
        error.value = 'El mesociclo se creó, pero no se pudo guardar el plan estructurado. Puedes regenerarlo desde su ficha.'
      }
    }

    router.push(created?.id ? `/mesocycles/${created.id}` : '/mesocycles')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Error al guardar el mesociclo. Inténtalo de nuevo.'
  } finally {
    saving.value = false
  }
}
</script>
