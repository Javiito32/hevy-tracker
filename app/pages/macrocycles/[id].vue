<template>
  <div class="max-w-5xl mx-auto">
    <NuxtLink to="/macrocycles" class="text-ink-3 hover:text-ink mb-4 inline-block transition">← Volver a Macrociclos</NuxtLink>

    <div v-if="pending" class="flex justify-center p-12">
      <UiSpinner size="lg" class="text-ink-3" />
    </div>

    <template v-else-if="macro">
      <!-- Header -->
      <div class="bg-surface-2 border border-line-strong hover:border-ink-3 text-ink rounded-card p-6 mb-6">
        <div class="flex items-start justify-between">
          <div>
            <h1 class="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] text-ink leading-none mb-1">{{ macro.name }}</h1>
            <p class="text-ink-2 text-sm">
              {{ formatDate(macro.start_date) }}
              <span v-if="macro.end_date"> → {{ formatDate(macro.end_date) }}</span>
              <span v-else> → en curso</span>
              <span v-if="durationWeeks"> &bull; ~{{ durationWeeks }} semanas</span>
            </p>
            <p v-if="macro.goal" class="text-ink-2 text-sm mt-2 max-w-xl">{{ macro.goal }}</p>
          </div>
          <button @click="showEdit = true" class="text-ink-2 hover:text-ink text-sm transition">Editar</button>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-3 gap-4 mt-5">
          <div class="bg-surface border border-line rounded-card p-3 text-center">
            <p class="font-data text-2xl text-ink">{{ macro.mesocycles.length }}</p>
            <p class="text-ink-2 text-xs mt-0.5">Mesociclos</p>
          </div>
          <div class="bg-surface border border-line rounded-card p-3 text-center">
            <p class="font-data text-2xl text-ink">{{ totalWorkouts }}</p>
            <p class="text-ink-2 text-xs mt-0.5">Entrenamientos</p>
          </div>
          <div class="bg-surface border border-line rounded-card p-3 text-center">
            <p class="font-data text-2xl text-ink truncate">{{ activeMeso?.name ?? '—' }}</p>
            <p class="text-ink-2 text-xs mt-0.5">Mesociclo activo</p>
          </div>
        </div>
      </div>

      <!-- Edit modal -->
      <div v-if="showEdit" class="fixed inset-0 bg-bg/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4" @click.self="showEdit = false">
        <div class="bg-surface border border-line-strong rounded-card w-full max-w-lg p-6">
          <h2 class="text-lg font-bold text-ink mb-4">Editar macrociclo</h2>
          <form @submit.prevent="saveMacro" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-ink-2 mb-1.5">Nombre *</label>
              <input v-model="editForm.name" type="text" required class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-2 mb-1.5">Objetivo</label>
              <textarea v-model="editForm.goal" rows="2" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"></textarea>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-ink-2 mb-1.5">Fecha inicio *</label>
                <input v-model="editForm.start_date" type="date" required class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
              </div>
              <div>
                <label class="block text-sm font-medium text-ink-2 mb-1.5">Fecha fin</label>
                <input v-model="editForm.end_date" type="date" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-2 mb-1.5">Notas</label>
              <textarea v-model="editForm.notes" rows="3" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"></textarea>
            </div>
            <div class="flex justify-between items-center pt-2">
              <button type="button" @click="confirmDelete" class="text-danger text-sm transition">Eliminar macrociclo</button>
              <div class="flex gap-3">
                <button type="button" @click="showEdit = false" class="px-4 py-2 text-sm text-ink-2 hover:text-ink transition">Cancelar</button>
                <button type="submit" :disabled="saving" class="px-4 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 disabled:opacity-50 transition">
                  {{ saving ? 'Guardando...' : 'Guardar' }}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Mesocycles timeline -->
        <div class="lg:col-span-2 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Mesociclos</h2>
            <button @click="showAssign = !showAssign" class="text-sm text-ink-3 hover:text-ink transition">Asignar mesociclo</button>
          </div>

          <!-- Assign mesocycle panel -->
          <div v-if="showAssign" class="bg-surface-2 border border-line rounded-card p-4">
            <p class="text-sm font-medium text-ink-2 mb-2">Selecciona un mesociclo sin macrociclo:</p>
            <div v-if="!unassignedMesos?.length" class="text-sm text-ink-3 italic">Todos los mesociclos ya están asignados.</div>
            <div v-else class="space-y-2">
              <div
                v-for="meso in unassignedMesos"
                :key="meso.id"
                class="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2 text-sm border border-line-strong"
              >
                <span class="font-medium text-ink">{{ meso.name }}</span>
                <button @click="assignMeso(meso.id)" class="text-ink-3 hover:text-ink text-xs font-medium transition">Añadir</button>
              </div>
            </div>
          </div>

          <!-- Timeline -->
          <div v-if="!macro.mesocycles.length" class="bg-surface rounded-card border border-line p-6 text-center text-ink-3 text-sm">
            Sin mesociclos asignados. Usa el botón de arriba para asignarlos.
          </div>
          <div v-else class="relative">
            <div class="absolute left-4 top-0 bottom-0 w-0.5 bg-surface-2"></div>
            <div class="space-y-3">
              <NuxtLink
                v-for="(meso, i) in macro.mesocycles"
                :key="meso.id"
                :to="`/mesocycles/${meso.id}`"
                class="flex gap-4 relative group"
              >
                <div class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-ink z-10 mt-1"
                  :class="statusDotBg(meso.status)">
                  {{ i + 1 }}
                </div>
                <div class="flex-1 bg-surface rounded-card border border-line px-4 py-3 hover:border-line-strong transition">
                  <div class="flex items-start justify-between">
                    <div>
                      <p class="font-medium text-ink group-hover:text-ink-2 transition">{{ meso.name }}</p>
                      <p class="text-xs text-ink-3 mt-0.5">
                        {{ formatDate(meso.start_date) }}<span v-if="meso.end_date"> → {{ formatDate(meso.end_date) }}</span>
                      </p>
                      <p v-if="meso.goal" class="text-xs text-ink-3 mt-1 line-clamp-1">{{ meso.goal }}</p>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span :class="statusBadge(meso.status)" class="text-xs font-medium px-2 py-0.5 rounded-full">{{ statusLabel(meso.status) }}</span>
                      <span class="text-xs text-ink-3">{{ meso._count.workouts }} entrenos</span>
                    </div>
                  </div>
                  <div v-if="meso.diary_notes?.length" class="mt-2 border-t border-line pt-2">
                    <p class="text-xs text-ink-3 italic line-clamp-1">
                      "{{ meso.diary_notes[0].content }}"
                    </p>
                  </div>
                </div>
              </NuxtLink>
            </div>
          </div>
        </div>

        <!-- Right: notes + info -->
        <div class="space-y-6">
          <div v-if="macro.notes" class="bg-surface rounded-card border border-line p-5">
            <h3 class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-2">Notas generales</h3>
            <p class="text-sm text-ink-2 whitespace-pre-wrap">{{ macro.notes }}</p>
          </div>

          <div v-if="macro.mesocycles.length > 1" class="bg-surface rounded-card border border-line p-5">
            <h3 class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-3">Entrenamientos por mesociclo</h3>
            <div class="space-y-2">
              <div v-for="meso in macro.mesocycles" :key="meso.id">
                <div class="flex justify-between text-xs text-ink-3 mb-0.5">
                  <span class="truncate max-w-[140px]">{{ meso.name }}</span>
                  <span>{{ meso._count.workouts }}</span>
                </div>
                <div class="w-full bg-surface-2 rounded-full h-1.5">
                  <div
                    class="h-1.5 rounded-full bg-accent"
                    :style="{ width: `${Math.max(4, (meso._count.workouts / maxWorkouts) * 100)}%` }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="text-center py-12">
      <p class="text-ink-3">Macrociclo no encontrado.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
const macroId = route.params.id as string

const { data: macro, pending, refresh } = useFetch(`/api/macrocycles/${macroId}`)
const { data: allMesos } = useFetch('/api/mesocycles')

const showEdit = ref(false)
const showAssign = ref(false)
const saving = ref(false)

const editForm = ref({ name: '', goal: '', start_date: '', end_date: '', notes: '' })

watch(macro, (m) => {
  if (!m) return
  editForm.value = {
    name: (m as any).name ?? '',
    goal: (m as any).goal ?? '',
    start_date: (m as any).start_date ? (m as any).start_date.slice(0, 10) : '',
    end_date: (m as any).end_date ? (m as any).end_date.slice(0, 10) : '',
    notes: (m as any).notes ?? ''
  }
}, { immediate: true })

const durationWeeks = computed(() => {
  if (!(macro.value as any)?.start_date) return null
  const end = (macro.value as any).end_date ? new Date((macro.value as any).end_date) : new Date()
  const weeks = Math.round((end.getTime() - new Date((macro.value as any).start_date).getTime()) / (7 * 24 * 60 * 60 * 1000))
  return weeks > 0 ? weeks : null
})

const totalWorkouts = computed(() =>
  ((macro.value as any)?.mesocycles ?? []).reduce((s: number, m: any) => s + m._count.workouts, 0)
)

const activeMeso = computed(() =>
  ((macro.value as any)?.mesocycles ?? []).find((m: any) => m.status === 'active')
)

const maxWorkouts = computed(() => {
  const counts = ((macro.value as any)?.mesocycles ?? []).map((m: any) => m._count.workouts)
  return Math.max(...counts, 1)
})

const unassignedMesos = computed(() => {
  if (!allMesos.value) return []
  const assigned = new Set(((macro.value as any)?.mesocycles ?? []).map((m: any) => m.id))
  return (allMesos.value as any[]).filter((m: any) => !assigned.has(m.id) && !m.macrocycle_id)
})

const saveMacro = async () => {
  saving.value = true
  try {
    await $fetch(`/api/macrocycles/${macroId}`, { method: 'PATCH', body: editForm.value })
    await refresh()
    showEdit.value = false
  } finally {
    saving.value = false
  }
}

const confirmDelete = async () => {
  if (!confirm('¿Eliminar este macrociclo? Los mesociclos no se borrarán.')) return
  await $fetch(`/api/macrocycles/${macroId}`, { method: 'DELETE' })
  router.push('/macrocycles')
}

const assignMeso = async (mesoId: string) => {
  await $fetch(`/api/mesocycles/${mesoId}`, { method: 'PATCH', body: { macrocycle_id: macroId } })
  await refresh()
}

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

const statusLabel = (s: string) =>
  ({ active: 'Activo', paused: 'Pausado', completed: 'Completado' }[s] ?? s)

const statusBadge = (s: string) =>
  ({ active: 'bg-positive/10 text-positive', paused: 'bg-warn/10 text-warn', completed: 'bg-surface-2 text-ink-3' }[s] ?? 'bg-surface-2 text-ink-3')

const statusDotBg = (s: string) =>
  ({ active: 'bg-positive', paused: 'bg-warn', completed: 'bg-surface-2' }[s] ?? 'bg-surface-2')
</script>
