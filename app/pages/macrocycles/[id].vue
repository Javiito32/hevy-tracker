<template>
  <div class="max-w-5xl mx-auto">
    <NuxtLink to="/macrocycles" class="text-blue-600 hover:underline mb-4 inline-block">← Volver a Macrociclos</NuxtLink>

    <div v-if="pending" class="flex justify-center p-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-blue-500 border-t-transparent"></div>
    </div>

    <template v-else-if="macro">
      <!-- Header -->
      <div class="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl shadow p-6 mb-6">
        <div class="flex items-start justify-between">
          <div>
            <h1 class="text-3xl font-bold mb-1">{{ macro.name }}</h1>
            <p class="text-blue-100 text-sm">
              {{ formatDate(macro.start_date) }}
              <span v-if="macro.end_date"> → {{ formatDate(macro.end_date) }}</span>
              <span v-else> → en curso</span>
              <span v-if="durationWeeks"> &bull; ~{{ durationWeeks }} semanas</span>
            </p>
            <p v-if="macro.goal" class="text-blue-100 text-sm mt-2 max-w-xl">{{ macro.goal }}</p>
          </div>
          <button @click="showEdit = true" class="text-blue-200 hover:text-white text-sm">Editar</button>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-3 gap-4 mt-5">
          <div class="bg-white/10 rounded-lg p-3 text-center">
            <p class="text-2xl font-bold">{{ macro.mesocycles.length }}</p>
            <p class="text-blue-100 text-xs mt-0.5">Mesociclos</p>
          </div>
          <div class="bg-white/10 rounded-lg p-3 text-center">
            <p class="text-2xl font-bold">{{ totalWorkouts }}</p>
            <p class="text-blue-100 text-xs mt-0.5">Entrenamientos</p>
          </div>
          <div class="bg-white/10 rounded-lg p-3 text-center">
            <p class="text-2xl font-bold">{{ activeMeso?.name ?? '—' }}</p>
            <p class="text-blue-100 text-xs mt-0.5">Mesociclo activo</p>
          </div>
        </div>
      </div>

      <!-- Edit modal -->
      <div v-if="showEdit" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
          <h2 class="text-lg font-bold text-gray-800 mb-4">Editar macrociclo</h2>
          <form @submit.prevent="saveMacro" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
              <input v-model="editForm.name" type="text" required class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Objetivo</label>
              <textarea v-model="editForm.goal" rows="2" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
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
              <label class="block text-sm font-medium text-gray-700 mb-1">Notas</label>
              <textarea v-model="editForm.notes" rows="3" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
            </div>
            <div class="flex justify-between items-center pt-2">
              <button type="button" @click="confirmDelete" class="text-red-500 hover:text-red-700 text-sm">Eliminar macrociclo</button>
              <div class="flex gap-3">
                <button type="button" @click="showEdit = false" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
                <button type="submit" :disabled="saving" class="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
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
            <h2 class="text-lg font-semibold text-gray-800">Mesociclos</h2>
            <button @click="showAssign = !showAssign" class="text-sm text-blue-600 hover:underline">Asignar mesociclo</button>
          </div>

          <!-- Assign mesocycle panel -->
          <div v-if="showAssign" class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p class="text-sm font-medium text-gray-700 mb-2">Selecciona un mesociclo sin macrociclo:</p>
            <div v-if="!unassignedMesos?.length" class="text-sm text-gray-400 italic">Todos los mesociclos ya están asignados.</div>
            <div v-else class="space-y-2">
              <div
                v-for="meso in unassignedMesos"
                :key="meso.id"
                class="flex items-center justify-between bg-white rounded px-3 py-2 text-sm border border-gray-200"
              >
                <span class="font-medium text-gray-800">{{ meso.name }}</span>
                <button @click="assignMeso(meso.id)" class="text-blue-600 hover:text-blue-800 text-xs font-medium">Añadir</button>
              </div>
            </div>
          </div>

          <!-- Timeline -->
          <div v-if="!macro.mesocycles.length" class="bg-white rounded-lg shadow p-6 text-center text-gray-400 text-sm">
            Sin mesociclos asignados. Usa el botón de arriba para asignarlos.
          </div>
          <div v-else class="relative">
            <!-- Vertical line -->
            <div class="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>
            <div class="space-y-3">
              <NuxtLink
                v-for="(meso, i) in macro.mesocycles"
                :key="meso.id"
                :to="`/mesocycles/${meso.id}`"
                class="flex gap-4 relative group"
              >
                <!-- Dot -->
                <div class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold text-white z-10 mt-1"
                  :class="statusDotBg(meso.status)">
                  {{ i + 1 }}
                </div>
                <!-- Card -->
                <div class="flex-1 bg-white rounded-lg shadow-sm border border-gray-100 px-4 py-3 hover:shadow-md transition">
                  <div class="flex items-start justify-between">
                    <div>
                      <p class="font-medium text-gray-800 group-hover:text-blue-600">{{ meso.name }}</p>
                      <p class="text-xs text-gray-500 mt-0.5">
                        {{ formatDate(meso.start_date) }}<span v-if="meso.end_date"> → {{ formatDate(meso.end_date) }}</span>
                      </p>
                      <p v-if="meso.goal" class="text-xs text-gray-400 mt-1 line-clamp-1">{{ meso.goal }}</p>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                      <span :class="statusBadge(meso.status)" class="text-xs font-medium px-2 py-0.5 rounded-full">{{ statusLabel(meso.status) }}</span>
                      <span class="text-xs text-gray-400">{{ meso._count.workouts }} entrenos</span>
                    </div>
                  </div>
                  <!-- Recent notes preview -->
                  <div v-if="meso.diary_notes?.length" class="mt-2 border-t border-gray-100 pt-2">
                    <p class="text-xs text-gray-400 italic line-clamp-1">
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
          <div v-if="macro.notes" class="bg-white rounded-lg shadow p-5">
            <h3 class="text-sm font-semibold text-gray-700 mb-2">Notas generales</h3>
            <p class="text-sm text-gray-600 whitespace-pre-wrap">{{ macro.notes }}</p>
          </div>

          <!-- Volume progression across mesocycles -->
          <div v-if="macro.mesocycles.length > 1" class="bg-white rounded-lg shadow p-5">
            <h3 class="text-sm font-semibold text-gray-700 mb-3">Entrenamientos por mesociclo</h3>
            <div class="space-y-2">
              <div v-for="meso in macro.mesocycles" :key="meso.id">
                <div class="flex justify-between text-xs text-gray-600 mb-0.5">
                  <span class="truncate max-w-[140px]">{{ meso.name }}</span>
                  <span>{{ meso._count.workouts }}</span>
                </div>
                <div class="w-full bg-gray-100 rounded-full h-1.5">
                  <div
                    class="h-1.5 rounded-full bg-blue-400"
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
      <p class="text-gray-500">Macrociclo no encontrado.</p>
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
  ({ active: 'bg-green-100 text-green-700', paused: 'bg-yellow-100 text-yellow-700', completed: 'bg-gray-100 text-gray-600' }[s] ?? 'bg-gray-100 text-gray-600')

const statusDotBg = (s: string) =>
  ({ active: 'bg-green-500', paused: 'bg-yellow-400', completed: 'bg-gray-400' }[s] ?? 'bg-gray-400')
</script>
