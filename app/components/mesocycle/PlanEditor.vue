<template>
  <UiModal
    :open="open"
    title="Editar rutina del bloque"
    hint="Esto es lo que se envía a Hevy. Cada ejercicio necesita estar enlazado con el catálogo para poder enviarse."
    size="xl"
    @close="$emit('close')"
  >
    <div class="space-y-5">
      <!-- Sessions -->
      <div v-for="(session, si) in draft" :key="si" class="border border-line rounded-card overflow-hidden">
        <div class="bg-surface-2 px-4 py-3 flex items-start gap-3 flex-wrap">
          <div class="flex-1 min-w-[12rem]">
            <UiField label="Sesión" required>
              <UiInput v-model="session.name" placeholder="Ej: Empuje A" />
            </UiField>
          </div>
          <div class="w-36">
            <UiField label="Día">
              <UiSelect v-model="session.day_of_week">
                <option :value="null">Sin día fijo</option>
                <option v-for="(d, i) in DAY_NAMES" :key="i" :value="i + 1">{{ d }}</option>
              </UiSelect>
            </UiField>
          </div>
          <div class="flex items-center gap-1 pt-6">
            <UiButton size="sm" variant="ghost" :disabled="si === 0" title="Subir" @click="moveSession(si, -1)">↑</UiButton>
            <UiButton size="sm" variant="ghost" :disabled="si === draft.length - 1" title="Bajar" @click="moveSession(si, 1)">↓</UiButton>
            <UiButton size="sm" variant="ghost" title="Eliminar sesión" @click="removeSession(si)">✕</UiButton>
          </div>
        </div>

        <!-- Exercises -->
        <div v-if="!session.exercises.length" class="px-4 py-5 text-xs text-ink-3">
          Sin ejercicios. Una sesión vacía no se puede guardar.
        </div>

        <ul v-else class="divide-y divide-line">
          <li v-for="(ex, ei) in session.exercises" :key="ei" class="px-4 py-3">
            <div class="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
              <div class="min-w-0 flex items-baseline gap-2 flex-wrap">
                <span class="text-sm font-medium text-ink">{{ ex.name }}</span>
                <!-- An unlinked exercise still prescribes the movement; it just
                     cannot be pushed. Said here rather than at push time, which
                     is far too late to fix it. -->
                <UiBadge v-if="!ex.exercise_template_id" tone="warn">Sin enlazar · no se enviará a Hevy</UiBadge>
              </div>
              <div class="flex items-center gap-1 flex-shrink-0">
                <UiButton size="sm" variant="ghost" :disabled="ei === 0" title="Subir" @click="moveExercise(session, ei, -1)">↑</UiButton>
                <UiButton size="sm" variant="ghost" :disabled="ei === session.exercises.length - 1" title="Bajar" @click="moveExercise(session, ei, 1)">↓</UiButton>
                <UiButton size="sm" variant="ghost" title="Quitar ejercicio" @click="session.exercises.splice(ei, 1)">✕</UiButton>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <UiField label="Series">
                <UiInput v-model.number="ex.target_sets" type="number" min="1" max="20" />
              </UiField>
              <UiField label="Reps mín">
                <UiInput v-model.number="ex.rep_min" type="number" min="1" max="100" />
              </UiField>
              <UiField label="Reps máx">
                <UiInput v-model.number="ex.rep_max" type="number" min="1" max="100" />
              </UiField>
              <UiField label="RIR">
                <UiInput v-model.number="ex.target_rir" type="number" min="0" max="10" step="0.5" />
              </UiField>
              <UiField label="Descanso" unit="s">
                <UiInput v-model.number="ex.rest_seconds" type="number" min="0" max="600" step="15" />
              </UiField>
            </div>
          </li>
        </ul>

        <!-- Exercise picker -->
        <div class="px-4 py-3 border-t border-line bg-surface-2/50">
          <UiButton v-if="pickerFor !== si" size="sm" variant="secondary" @click="openPicker(si)">
            + Añadir ejercicio
          </UiButton>

          <div v-else class="space-y-2">
            <div class="flex items-center gap-2">
              <UiInput v-model="pickerQuery" placeholder="Buscar en el catálogo de Hevy…" autofocus />
              <UiButton size="sm" variant="ghost" @click="pickerFor = null">Cerrar</UiButton>
            </div>

            <p v-if="pickerLoading" class="text-xs text-ink-3 flex items-center gap-2"><UiSpinner size="sm" /> Buscando…</p>
            <p v-else-if="pickerNote" class="text-xs text-warn">{{ pickerNote }}</p>
            <p v-else-if="!pickerResults.length && pickerQuery" class="text-xs text-ink-3">Sin resultados.</p>

            <ul v-if="pickerResults.length" class="max-h-56 overflow-y-auto divide-y divide-line border border-line rounded-lg">
              <li v-for="hit in pickerResults" :key="hit.id">
                <button
                  type="button"
                  class="w-full text-left px-3 py-2 hover:bg-surface-2 transition flex items-baseline justify-between gap-3"
                  @click="addExercise(session, hit)"
                >
                  <span class="text-sm text-ink">{{ hit.title }}</span>
                  <span class="font-data text-[11px] text-ink-3 whitespace-nowrap">
                    {{ hit.primary_label }}<span v-if="hit.familiarity"> · {{ hit.familiarity }}×</span>
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <UiButton variant="secondary" block @click="addSession">+ Añadir sesión</UiButton>

      <!-- Weeks -->
      <div class="border border-line rounded-card overflow-hidden">
        <div class="bg-surface-2 px-4 py-3">
          <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-1">Progresión</p>
          <h3 class="font-display text-sm font-semibold tracking-tight text-ink">Semanas del bloque</h3>
          <p class="text-xs text-ink-3 mt-1">
            El RIR y el multiplicador de la semana <strong>sustituyen</strong> a los del ejercicio: una descarga
            se define bajando todo, no con excepciones por movimiento.
          </p>
        </div>

        <ul v-if="weeks.length" class="divide-y divide-line">
          <li v-for="(w, wi) in weeks" :key="wi" class="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5 items-end">
            <UiField label="Semana">
              <UiInput v-model.number="w.week_number" type="number" min="1" max="24" />
            </UiField>
            <UiField label="RIR objetivo">
              <UiInput v-model.number="w.target_rir" type="number" min="0" max="10" step="0.5" />
            </UiField>
            <UiField label="× volumen">
              <UiInput v-model.number="w.volume_multiplier" type="number" min="0.1" max="2" step="0.1" />
            </UiField>
            <div class="flex items-center justify-between gap-2 pb-2">
              <label class="flex items-center gap-2 text-xs text-ink-2 cursor-pointer">
                <input v-model="w.is_deload" type="checkbox" class="accent-current" />
                Descarga
              </label>
              <UiButton size="sm" variant="ghost" title="Quitar semana" @click="weeks.splice(wi, 1)">✕</UiButton>
            </div>
          </li>
        </ul>
        <p v-else class="px-4 py-4 text-xs text-ink-3">
          Sin semanas definidas: cada semana usará el RIR de cada ejercicio, sin descargas.
        </p>

        <div class="px-4 py-3 border-t border-line">
          <UiButton size="sm" variant="secondary" @click="addWeek">+ Añadir semana</UiButton>
        </div>
      </div>

      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="$emit('close')">Cancelar</UiButton>
      <UiButton :loading="saving" @click="save">Guardar rutina</UiButton>
    </template>
  </UiModal>
</template>

<script setup lang="ts">
/**
 * Editor for the structured plan — the thing that becomes the Hevy routine.
 *
 * It edits a **deep copy** and only writes on save: the plan is also what the
 * page behind it renders (next session, adherence), and mutating it in place
 * would repaint those cards live with a half-typed prescription.
 *
 * Exercises are only ever added from the catalogue search, never typed free
 * hand, because Hevy accepts exercises by template id alone. A typed name
 * produces a row that looks identical and is silently dropped from the routine.
 */
const props = defineProps<{ open: boolean; mesocycleId: string; plan: any }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const toast = useToast()

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

type DraftExercise = {
  exercise_template_id: string | null
  name: string
  target_sets: number
  rep_min: number | null
  rep_max: number | null
  target_rir: number | null
  rest_seconds: number | null
  progression_scheme: string
  notes: string | null
}
type DraftSession = { name: string; day_of_week: number | null; notes: string | null; exercises: DraftExercise[] }
type DraftWeek = { week_number: number; is_deload: boolean; target_rir: number | null; volume_multiplier: number; notes: string | null }

const draft = ref<DraftSession[]>([])
const weeks = ref<DraftWeek[]>([])
const saving = ref(false)
const error = ref('')

/** Reload the copy every time the dialog opens, so a cancelled edit leaves nothing behind. */
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  error.value = ''
  pickerFor.value = null
  draft.value = (props.plan?.sessions ?? []).map((s: any) => ({
    name: s.name,
    day_of_week: s.day_of_week ?? null,
    notes: s.notes ?? null,
    exercises: (s.exercises ?? []).map((e: any) => ({
      exercise_template_id: e.exercise_template_id ?? null,
      name: e.name,
      target_sets: e.target_sets ?? 3,
      rep_min: e.rep_min ?? null,
      rep_max: e.rep_max ?? null,
      target_rir: e.target_rir ?? null,
      rest_seconds: e.rest_seconds ?? null,
      progression_scheme: e.progression_scheme ?? 'double_progression',
      notes: e.notes ?? null
    }))
  }))
  weeks.value = (props.plan?.weeks ?? []).map((w: any) => ({
    week_number: w.week_number,
    is_deload: !!w.is_deload,
    target_rir: w.target_rir ?? null,
    volume_multiplier: w.volume_multiplier ?? 1,
    notes: w.notes ?? null
  }))
}, { immediate: true })

const moveSession = (i: number, delta: number) => {
  const [row] = draft.value.splice(i, 1)
  draft.value.splice(i + delta, 0, row)
}
const removeSession = (i: number) => {
  draft.value.splice(i, 1)
  pickerFor.value = null
}
const addSession = () => {
  draft.value.push({ name: `Sesión ${draft.value.length + 1}`, day_of_week: null, notes: null, exercises: [] })
}
const moveExercise = (session: DraftSession, i: number, delta: number) => {
  const [row] = session.exercises.splice(i, 1)
  session.exercises.splice(i + delta, 0, row)
}

const addWeek = () => {
  const next = weeks.value.length ? Math.max(...weeks.value.map(w => w.week_number)) + 1 : 1
  weeks.value.push({ week_number: next, is_deload: false, target_rir: null, volume_multiplier: 1, notes: null })
}

// --- Catalogue picker -------------------------------------------------------
const pickerFor = ref<number | null>(null)
const pickerQuery = ref('')
const pickerResults = ref<any[]>([])
const pickerNote = ref('')
const pickerLoading = ref(false)

const openPicker = (si: number) => {
  pickerFor.value = si
  pickerQuery.value = ''
  pickerResults.value = []
  pickerNote.value = ''
  runSearch()
}

// Debounced: the catalogue is ~400 rows behind a DB query, and a request per
// keystroke would fire a dozen for one exercise name.
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(pickerQuery, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 250)
})

// Guards against the out-of-order response: a slow "pre" landing after a fast
// "press" would repaint the list with results for what the user already retyped.
let searchSeq = 0
const runSearch = async () => {
  if (pickerFor.value === null) return
  const seq = ++searchSeq
  pickerLoading.value = true
  try {
    const res: any = await $fetch('/api/exercise-templates/search', {
      query: { query: pickerQuery.value || undefined, limit: 20 }
    })
    if (seq !== searchSeq) return
    pickerResults.value = res.results ?? []
    pickerNote.value = res.note ?? ''
  } catch {
    if (seq !== searchSeq) return
    pickerResults.value = []
    pickerNote.value = 'No se pudo consultar el catálogo.'
  } finally {
    if (seq === searchSeq) pickerLoading.value = false
  }
}

const addExercise = (session: DraftSession, hit: any) => {
  session.exercises.push({
    exercise_template_id: hit.id,
    name: hit.title,
    target_sets: 3,
    rep_min: 8,
    rep_max: 12,
    target_rir: 2,
    rest_seconds: 120,
    progression_scheme: 'double_progression',
    notes: null
  })
  pickerFor.value = null
}

// --- Save -------------------------------------------------------------------
const save = async () => {
  error.value = ''

  // Validated here as well as on the server so the athlete is told which
  // session is empty rather than being handed the endpoint's 400.
  if (!draft.value.length) {
    error.value = 'El plan necesita al menos una sesión.'
    return
  }
  for (const s of draft.value) {
    if (!s.name.trim()) { error.value = 'Cada sesión necesita un nombre.'; return }
    if (!s.exercises.length) { error.value = `La sesión "${s.name}" no tiene ejercicios.`; return }
    for (const e of s.exercises) {
      if (e.rep_min && e.rep_max && e.rep_min > e.rep_max) {
        error.value = `En "${e.name}" las reps mínimas superan a las máximas.`
        return
      }
    }
  }

  saving.value = true
  try {
    const res: any = await $fetch(`/api/mesocycles/${props.mesocycleId}/plan`, {
      method: 'PUT',
      body: {
        sessions: draft.value.map(s => ({
          ...s,
          day_of_week: Number(s.day_of_week) >= 1 && Number(s.day_of_week) <= 7 ? Number(s.day_of_week) : null
        })),
        weeks: weeks.value
      }
    })
    if (res.warning) toast.error(res.warning)
    else toast.success('Rutina guardada.')
    emit('saved')
    emit('close')
  } catch (err: any) {
    error.value = err?.data?.message ?? 'No se pudo guardar la rutina.'
  } finally {
    saving.value = false
  }
}
</script>
