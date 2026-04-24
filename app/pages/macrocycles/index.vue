<template>
  <div class="max-w-5xl mx-auto">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-3xl font-bold text-gray-800">Macrociclos</h1>
      <button
        @click="showForm = true"
        class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition shadow text-sm"
      >
        + Nuevo macrociclo
      </button>
    </div>

    <!-- Create form modal -->
    <div v-if="showForm" class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h2 class="text-lg font-bold text-gray-800 mb-4">Nuevo macrociclo</h2>
        <form @submit.prevent="createMacro" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
            <input v-model="form.name" type="text" required class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Ej: Preparación competición 2026" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Objetivo</label>
            <textarea v-model="form.goal" rows="2" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="¿Qué quieres lograr en este macrociclo?"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Fecha inicio *</label>
              <input v-model="form.start_date" type="date" required class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Fecha fin</label>
              <input v-model="form.end_date" type="date" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Notas</label>
            <textarea v-model="form.notes" rows="2" class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"></textarea>
          </div>
          <div class="flex justify-end gap-3 pt-2">
            <button type="button" @click="showForm = false" class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
            <button type="submit" :disabled="saving" class="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50">
              {{ saving ? 'Guardando...' : 'Crear macrociclo' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-blue-500 border-t-transparent"></div>
    </div>

    <div v-else-if="!macrocycles?.length" class="bg-white rounded-lg shadow p-10 text-center text-gray-500">
      <p class="mb-4 text-sm">Aún no tienes macrociclos. Agrupa tus mesociclos en bloques de planificación a largo plazo.</p>
      <button @click="showForm = true" class="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition text-sm">
        Crear el primero
      </button>
    </div>

    <div v-else class="space-y-6">
      <div
        v-for="macro in macrocycles"
        :key="macro.id"
        class="bg-white rounded-xl shadow overflow-hidden"
      >
        <!-- Macro header -->
        <div class="px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white flex items-start justify-between">
          <div>
            <NuxtLink :to="`/macrocycles/${macro.id}`" class="text-lg font-bold hover:underline">{{ macro.name }}</NuxtLink>
            <p class="text-blue-100 text-xs mt-0.5">
              {{ formatDate(macro.start_date) }}
              <span v-if="macro.end_date"> → {{ formatDate(macro.end_date) }}</span>
              <span v-else> → en curso</span>
              &bull; {{ macro.mesocycles.length }} mesociclo{{ macro.mesocycles.length !== 1 ? 's' : '' }}
            </p>
            <p v-if="macro.goal" class="text-blue-100 text-xs mt-1 line-clamp-1">{{ macro.goal }}</p>
          </div>
          <NuxtLink :to="`/macrocycles/${macro.id}`" class="text-blue-200 hover:text-white text-xs mt-1">Ver detalle →</NuxtLink>
        </div>

        <!-- Mesocycles timeline -->
        <div v-if="macro.mesocycles.length" class="divide-y divide-gray-100">
          <NuxtLink
            v-for="meso in macro.mesocycles"
            :key="meso.id"
            :to="`/mesocycles/${meso.id}`"
            class="flex items-center justify-between px-6 py-3 hover:bg-gray-50 transition"
          >
            <div class="flex items-center gap-3">
              <span :class="statusDot(meso.status)" class="w-2 h-2 rounded-full flex-shrink-0"></span>
              <div>
                <p class="text-sm font-medium text-gray-800">{{ meso.name }}</p>
                <p class="text-xs text-gray-500">{{ formatDate(meso.start_date) }}<span v-if="meso.end_date"> → {{ formatDate(meso.end_date) }}</span></p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-gray-400">{{ meso._count.workouts }} entrenos</span>
              <span :class="statusBadge(meso.status)" class="text-xs font-medium px-2 py-0.5 rounded-full capitalize">{{ statusLabel(meso.status) }}</span>
            </div>
          </NuxtLink>
        </div>
        <div v-else class="px-6 py-4 text-sm text-gray-400 italic">
          Sin mesociclos asignados.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const { data: macrocycles, pending, refresh } = useFetch('/api/macrocycles')

const showForm = ref(false)
const saving = ref(false)
const form = ref({ name: '', goal: '', start_date: '', end_date: '', notes: '' })

const createMacro = async () => {
  saving.value = true
  try {
    await $fetch('/api/macrocycles', { method: 'POST', body: form.value })
    await refresh()
    showForm.value = false
    form.value = { name: '', goal: '', start_date: '', end_date: '', notes: '' }
  } finally {
    saving.value = false
  }
}

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

const statusLabel = (s: string) =>
  ({ active: 'Activo', paused: 'Pausado', completed: 'Completado' }[s] ?? s)

const statusBadge = (s: string) =>
  ({ active: 'bg-green-100 text-green-700', paused: 'bg-yellow-100 text-yellow-700', completed: 'bg-gray-100 text-gray-600' }[s] ?? 'bg-gray-100 text-gray-600')

const statusDot = (s: string) =>
  ({ active: 'bg-green-500', paused: 'bg-yellow-400', completed: 'bg-gray-400' }[s] ?? 'bg-gray-400')
</script>
