<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden mb-8">
    <div class="px-5 py-3.5 border-b border-line">
      <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Mantenimiento de datos</h2>
      <p class="text-xs text-ink-3 mt-1">
        Todas las operaciones son reejecutables: se derivan de los datos crudos de Hevy, que nunca se modifican.
      </p>
    </div>

    <div class="p-6 space-y-6">
      <!-- Target user. The catalogue is global and ignores this. -->
      <div class="flex flex-wrap items-end gap-4">
        <div>
          <label class="block text-xs font-medium text-ink-3 mb-1.5">Usuario objetivo</label>
          <select
            v-model="targetUser"
            class="bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus transition"
          >
            <option value="__all__">Todos los usuarios</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
          </select>
        </div>
        <p class="text-xs text-ink-3 pb-2.5">
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
          class="text-left bg-surface-2 border border-line rounded-card p-4 hover:border-line-strong disabled:opacity-40 disabled:cursor-not-allowed transition group"
        >
          <div class="flex items-start justify-between gap-3 mb-1.5">
            <span class="font-medium text-ink text-sm group-hover:text-ink-2 transition">
              {{ op.order }}. {{ op.label }}
            </span>
            <span
              class="text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap"
              :class="op.online
                ? 'bg-surface-2/60 text-ink-2 border border-line-strong'
                : 'bg-surface-2 text-ink-3 border border-line-strong'"
            >{{ op.online ? 'red' : 'offline' }}</span>
          </div>
          <p class="text-xs text-ink-3 leading-relaxed">{{ op.description }}</p>
          <p v-if="op.warning" class="text-xs text-warn/80 mt-2">⚠ {{ op.warning }}</p>
        </button>
      </div>

      <!-- The history itself lives in the «Trabajos» tab; this is the pointer to
           it, shown only while something is actually running. -->
      <div v-if="anyRunning" class="border-t border-line pt-5 flex items-center gap-2 text-xs text-ink-2">
        <span class="w-1.5 h-1.5 rounded-full bg-ink-2 animate-pulse flex-shrink-0"></span>
        <span>Hay una operación en curso — su progreso se ve en la pestaña «Trabajos».</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const toast = useToast()

const props = defineProps<{ users: Array<{ id: string; name: string }> }>()

/** Job state is shared with the «Trabajos» tab — see `useMaintenanceJobs`. */
const { anyRunning, completed, loadJobs, startPolling } = useMaintenanceJobs()

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
const busy = ref(false)

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
    toast.success(`«${op.label}» lanzada. Sigue su progreso en la pestaña «Trabajos».`)
  } catch (err: any) {
    toast.error(err?.data?.message ?? 'No se pudo lanzar la operación.')
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadJobs()
  if (anyRunning.value) startPolling()
})
</script>
