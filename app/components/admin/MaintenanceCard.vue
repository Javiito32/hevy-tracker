<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden mb-8">
    <div class="px-6 py-4 border-b border-slate-800">
      <h2 class="text-lg font-semibold text-slate-100">Mantenimiento de datos</h2>
      <p class="text-xs text-slate-500 mt-1">
        Todas las operaciones son reejecutables: se derivan de los datos crudos de Hevy, que nunca se modifican.
      </p>
    </div>

    <div class="p-6 space-y-6">
      <!-- Target user. The catalogue is global and ignores this. -->
      <div class="flex flex-wrap items-end gap-4">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1.5">Usuario objetivo</label>
          <select
            v-model="targetUser"
            class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
          >
            <option value="__all__">Todos los usuarios</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
          </select>
        </div>
        <p class="text-xs text-slate-500 pb-2.5">
          El catálogo de ejercicios es global y no depende de esta selección.
        </p>
      </div>

      <!-- Operations. Ordered by dependency, and the order is enforced below. -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button
          v-for="op in operations"
          :key="op.kind"
          @click="confirmAndRun(op)"
          :disabled="busy || (op.blockedBy ? !completed.has(op.blockedBy) && !op.allowAnyway : false)"
          class="text-left bg-slate-800/60 border border-slate-700 rounded-xl p-4 hover:border-indigo-700 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition group"
        >
          <div class="flex items-start justify-between gap-3 mb-1.5">
            <span class="font-medium text-slate-200 text-sm group-hover:text-indigo-300 transition">
              {{ op.order }}. {{ op.label }}
            </span>
            <span
              class="text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap"
              :class="op.online
                ? 'bg-sky-950/60 text-sky-400 border border-sky-900'
                : 'bg-slate-800 text-slate-500 border border-slate-700'"
            >{{ op.online ? 'red' : 'offline' }}</span>
          </div>
          <p class="text-xs text-slate-500 leading-relaxed">{{ op.description }}</p>
          <p v-if="op.warning" class="text-xs text-amber-500/80 mt-2">⚠ {{ op.warning }}</p>
        </button>
      </div>

      <!-- Live progress + history -->
      <div v-if="jobs.length" class="border-t border-slate-800 pt-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-semibold text-slate-300">Trabajos recientes</h3>
          <span v-if="anyRunning" class="text-xs text-indigo-400 flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
            en curso
          </span>
        </div>

        <div class="space-y-2">
          <div
            v-for="job in jobs"
            :key="job.id"
            class="bg-slate-800/40 border border-slate-800 rounded-lg px-4 py-3"
          >
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="flex items-center gap-2 min-w-0">
                <span
                  class="w-2 h-2 rounded-full flex-shrink-0"
                  :class="{
                    'bg-indigo-400 animate-pulse': job.status === 'running' || job.status === 'pending',
                    'bg-emerald-400': job.status === 'done',
                    'bg-rose-400': job.status === 'error'
                  }"
                ></span>
                <span class="text-sm text-slate-300 truncate">{{ job.label }}</span>
                <span v-if="job.user_name" class="text-xs text-slate-600 truncate">· {{ job.user_name }}</span>
              </div>
              <span class="text-xs text-slate-600 font-mono">{{ formatDateTime(job.created_at) }}</span>
            </div>

            <!-- Determinate bar only when a total is known; otherwise the label
                 carries the state rather than a bar that fakes a percentage. -->
            <div v-if="job.status === 'running'" class="mt-2">
              <p class="text-xs text-slate-500 mb-1">
                {{ job.message }}
                <span v-if="job.progress_total > 0" class="font-mono">
                  ({{ job.progress_current }}/{{ job.progress_total }})
                </span>
              </p>
              <div v-if="job.progress_total > 0" class="w-full bg-slate-800 rounded-full h-1">
                <div
                  class="bg-indigo-500 h-1 rounded-full transition-all"
                  :style="{ width: Math.min(100, (job.progress_current / job.progress_total) * 100) + '%' }"
                ></div>
              </div>
            </div>

            <p v-else-if="job.status === 'done' && job.result" class="text-xs text-emerald-400/80 mt-1.5 font-mono">
              {{ describeResult(job.result) }}
            </p>
            <p v-else-if="job.status === 'error'" class="text-xs text-rose-400 mt-1.5">{{ job.error }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{ users: Array<{ id: string; name: string }> }>()

interface Job {
  id: string
  kind: string
  label: string
  user_id: string | null
  user_name: string | null
  status: string
  progress_current: number
  progress_total: number
  message: string | null
  result: Record<string, any> | null
  error: string | null
  created_at: string
}

interface Operation {
  kind: string
  order: number
  label: string
  description: string
  online: boolean
  warning?: string
  /** The job kind that must have run first, if any. */
  blockedBy?: string
  /** Lets an operation run before its dependency when re-running is harmless. */
  allowAnyway?: boolean
}

/**
 * Ordered by the dependency chain, and the order is real: rebuilding the
 * structure before the catalogue exists leaves every exercise unlinked, and
 * recalculating records before metrics enshrines the inflated volumes.
 */
const operations: Operation[] = [
  {
    kind: 'exercise_templates', order: 1,
    label: 'Sincronizar catálogo de ejercicios',
    description: 'Trae las plantillas de Hevy con su grupo muscular primario y secundario. Es la única operación que usa la red y la única global.',
    online: true
  },
  {
    kind: 'rebuild_exercises', order: 2,
    label: 'Reconstruir estructura de entrenos',
    description: 'Recorre los datos crudos ya guardados y regenera ejercicios y series normalizados, enlazándolos con su plantilla. No llama a Hevy.',
    online: false,
    blockedBy: 'exercise_templates',
    allowAnyway: true,
    warning: 'Sin el catálogo sincronizado antes, los ejercicios quedarán sin grupo muscular.'
  },
  {
    kind: 'recalc_metrics', order: 3,
    label: 'Recalcular métricas',
    description: 'Reescribe volumen, tonelaje, RPE medio y 1RM estimado con las reglas corregidas: sin series de calentamiento y con tope de repeticiones.',
    online: false,
    warning: 'El volumen histórico bajará: deja de contar el calentamiento como trabajo.'
  },
  {
    kind: 'recalc_records', order: 4,
    label: 'Recalcular récords',
    description: 'Reconstruye los récords personales recorriendo el historial en orden cronológico.',
    online: false,
    blockedBy: 'recalc_metrics',
    allowAnyway: true,
    warning: 'Ejecuta antes «Recalcular métricas», o los récords se fijarán sobre los volúmenes inflados.'
  }
]

const targetUser = ref('__all__')
const jobs = ref<Job[]>([])
const busy = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const anyRunning = computed(() =>
  jobs.value.some(j => j.status === 'running' || j.status === 'pending')
)

/** Kinds that have completed at least once, used to gate the dependent steps. */
const completed = computed(() => {
  const done = new Set<string>()
  for (const j of jobs.value) if (j.status === 'done') done.add(j.kind)
  return done
})

const loadJobs = async () => {
  try {
    const res = await $fetch<{ jobs: Job[]; running: boolean }>('/api/admin/jobs')
    jobs.value = res.jobs
  } catch {
    // Polling failures are transient and self-correcting; surfacing one as an
    // error banner would flash noise every time a request is slow.
  }
}

const confirmAndRun = async (op: Operation) => {
  const who = targetUser.value === '__all__' ? 'todos los usuarios' : props.users.find(u => u.id === targetUser.value)?.name
  const scope = op.kind === 'exercise_templates' ? 'toda la instalación' : who
  if (!confirm(`¿Ejecutar «${op.label}» sobre ${scope}?\n\n${op.warning ?? 'La operación es reejecutable y no destruye datos crudos.'}`)) return

  busy.value = true
  try {
    await $fetch('/api/admin/jobs', {
      method: 'POST',
      body: {
        kind: op.kind,
        ...(targetUser.value === '__all__' ? { allUsers: true } : { userId: targetUser.value })
      }
    })
    await loadJobs()
    startPolling()
  } catch (err: any) {
    alert(err?.data?.message ?? 'No se pudo lanzar la operación.')
  } finally {
    busy.value = false
  }
}

/** Poll only while something is running — a job list at rest doesn't change. */
const startPolling = () => {
  if (timer) return
  timer = setInterval(async () => {
    await loadJobs()
    if (!anyRunning.value) stopPolling()
  }, 2000)
}
const stopPolling = () => {
  if (timer) { clearInterval(timer); timer = null }
}

const describeResult = (r: Record<string, any>): string =>
  Object.entries(r)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ')

onMounted(async () => {
  await loadJobs()
  if (anyRunning.value) startPolling()
})
onBeforeUnmount(stopPolling)
</script>
