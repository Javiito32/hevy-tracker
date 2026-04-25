<template>
  <div class="max-w-5xl mx-auto">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-3xl font-bold text-slate-100">Macrociclos</h1>
      <button
        @click="showForm = true"
        class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 transition text-sm font-medium"
      >
        + Nuevo macrociclo
      </button>
    </div>

    <!-- Create form modal -->
    <div v-if="showForm" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div class="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h2 class="text-lg font-bold text-slate-100 mb-4">Nuevo macrociclo</h2>
        <form @submit.prevent="createMacro" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1.5">Nombre *</label>
            <input v-model="form.name" type="text" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" placeholder="Ej: Preparación competición 2026" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1.5">Objetivo</label>
            <textarea v-model="form.goal" rows="2" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" placeholder="¿Qué quieres lograr en este macrociclo?"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-400 mb-1.5">Fecha inicio *</label>
              <input v-model="form.start_date" type="date" required class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-400 mb-1.5">Fecha fin</label>
              <input v-model="form.end_date" type="date" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1.5">Notas</label>
            <textarea v-model="form.notes" rows="2" class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"></textarea>
          </div>
          <div class="flex justify-end gap-3 pt-2">
            <button type="button" @click="showForm = false" class="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition">Cancelar</button>
            <button type="submit" :disabled="saving" class="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-500 disabled:opacity-50 transition">
              {{ saving ? 'Guardando...' : 'Crear macrociclo' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent"></div>
    </div>

    <div v-else-if="!macrocycles?.length" class="bg-slate-900 rounded-xl border border-slate-800 p-10 text-center text-slate-500">
      <p class="mb-4 text-sm">Aún no tienes macrociclos. Agrupa tus mesociclos en bloques de planificación a largo plazo.</p>
      <button @click="showForm = true" class="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 transition text-sm">
        Crear el primero
      </button>
    </div>

    <div v-else class="space-y-6">
      <div
        v-for="macro in macrocycles"
        :key="macro.id"
        class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden"
      >
        <!-- Macro header -->
        <div class="px-6 py-4 bg-gradient-to-r from-indigo-900/60 to-violet-900/40 border-b border-indigo-900 flex items-start justify-between">
          <div>
            <NuxtLink :to="`/macrocycles/${macro.id}`" class="text-lg font-bold text-slate-100 hover:text-indigo-300 transition">{{ macro.name }}</NuxtLink>
            <p class="text-slate-500 text-xs mt-0.5">
              {{ formatDate(macro.start_date) }}
              <span v-if="macro.end_date"> → {{ formatDate(macro.end_date) }}</span>
              <span v-else> → en curso</span>
              &bull; {{ macro.mesocycles.length }} mesociclo{{ macro.mesocycles.length !== 1 ? 's' : '' }}
            </p>
            <p v-if="macro.goal" class="text-slate-400 text-xs mt-1 line-clamp-1">{{ macro.goal }}</p>
          </div>
          <NuxtLink :to="`/macrocycles/${macro.id}`" class="text-indigo-400 hover:text-indigo-300 text-xs mt-1 transition">Ver detalle →</NuxtLink>
        </div>

        <!-- Mesocycles timeline -->
        <div v-if="macro.mesocycles.length" class="divide-y divide-slate-800">
          <NuxtLink
            v-for="meso in macro.mesocycles"
            :key="meso.id"
            :to="`/mesocycles/${meso.id}`"
            class="flex items-center justify-between px-6 py-3 hover:bg-slate-800/50 transition"
          >
            <div class="flex items-center gap-3">
              <span :class="statusDot(meso.status)" class="w-2 h-2 rounded-full flex-shrink-0"></span>
              <div>
                <p class="text-sm font-medium text-slate-300">{{ meso.name }}</p>
                <p class="text-xs text-slate-500">{{ formatDate(meso.start_date) }}<span v-if="meso.end_date"> → {{ formatDate(meso.end_date) }}</span></p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-slate-500">{{ meso._count.workouts }} entrenos</span>
              <span :class="statusBadge(meso.status)" class="text-xs font-medium px-2 py-0.5 rounded-full capitalize">{{ statusLabel(meso.status) }}</span>
            </div>
          </NuxtLink>
        </div>
        <div v-else class="px-6 py-4 text-sm text-slate-500 italic">
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
  ({ active: 'bg-emerald-950/60 text-emerald-400', paused: 'bg-amber-950/60 text-amber-400', completed: 'bg-slate-800 text-slate-500' }[s] ?? 'bg-slate-800 text-slate-500')

const statusDot = (s: string) =>
  ({ active: 'bg-emerald-500', paused: 'bg-amber-400', completed: 'bg-slate-500' }[s] ?? 'bg-slate-500')
</script>
