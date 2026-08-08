<template>
  <div class="max-w-5xl mx-auto">
    <div class="flex justify-between items-center mb-6">
      <h1 class="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] text-ink leading-none">Macrociclos</h1>
      <button
        @click="showForm = true"
        class="bg-accent text-accent-ink px-4 py-2 rounded-lg hover:opacity-85 transition text-sm font-medium"
      >
        + Nuevo macrociclo
      </button>
    </div>

    <!-- Create form modal -->
    <div v-if="showForm" class="fixed inset-0 bg-bg/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4" .self="showForm = false">
      <div class="bg-surface border border-line-strong rounded-card w-full max-w-lg p-6">
        <h2 class="text-lg font-bold text-ink mb-4">Nuevo macrociclo</h2>
        <form @submit.prevent="createMacro" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-ink-2 mb-1.5">Nombre *</label>
            <input v-model="form.name" type="text" required class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" placeholder="Ej: Preparación competición 2026" />
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-2 mb-1.5">Objetivo</label>
            <textarea v-model="form.goal" rows="2" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" placeholder="¿Qué quieres lograr en este macrociclo?"></textarea>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-ink-2 mb-1.5">Fecha inicio *</label>
              <input v-model="form.start_date" type="date" required class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-2 mb-1.5">Fecha fin</label>
              <input v-model="form.end_date" type="date" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-ink-2 mb-1.5">Notas</label>
            <textarea v-model="form.notes" rows="2" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"></textarea>
          </div>
          <div class="flex justify-end gap-3 pt-2">
            <button type="button" @click="showForm = false" class="px-4 py-2 text-sm text-ink-2 hover:text-ink transition">Cancelar</button>
            <button type="submit" :disabled="saving" class="px-4 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 disabled:opacity-50 transition">
              {{ saving ? 'Guardando...' : 'Crear macrociclo' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <UiSpinner size="lg" class="text-ink-3" />
    </div>

    <div v-else-if="!macrocycles?.length" class="bg-surface rounded-card border border-line p-10 text-center text-ink-3">
      <p class="mb-4 text-sm">Aún no tienes macrociclos. Agrupa tus mesociclos en bloques de planificación a largo plazo.</p>
      <button @click="showForm = true" class="inline-block bg-accent text-accent-ink px-4 py-2 rounded-lg hover:opacity-85 transition text-sm">
        Crear el primero
      </button>
    </div>

    <div v-else class="space-y-6">
      <div
        v-for="macro in macrocycles"
        :key="macro.id"
        class="bg-surface rounded-card border border-line overflow-hidden"
      >
        <!-- Macro header -->
        <div class="px-6 py-4 bg-surface-2 border-b border-line-strong flex items-start justify-between">
          <div>
            <NuxtLink :to="`/macrocycles/${macro.id}`" class="text-lg font-bold text-ink-3 hover:text-ink transition">{{ macro.name }}</NuxtLink>
            <p class="text-ink-3 text-xs mt-0.5">
              {{ formatDate(macro.start_date) }}
              <span v-if="macro.end_date"> → {{ formatDate(macro.end_date) }}</span>
              <span v-else> → en curso</span>
              &bull; {{ macro.mesocycles.length }} mesociclo{{ macro.mesocycles.length !== 1 ? 's' : '' }}
            </p>
            <p v-if="macro.goal" class="text-ink-2 text-xs mt-1 line-clamp-1">{{ macro.goal }}</p>
          </div>
          <NuxtLink :to="`/macrocycles/${macro.id}`" class="text-ink-3 hover:text-ink text-xs mt-1 transition">Ver detalle →</NuxtLink>
        </div>

        <!-- Mesocycles timeline -->
        <div v-if="macro.mesocycles.length" class="divide-y divide-line">
          <NuxtLink
            v-for="meso in macro.mesocycles"
            :key="meso.id"
            :to="`/mesocycles/${meso.id}`"
            class="flex items-center justify-between px-6 py-3 hover:bg-surface-2/50 transition"
          >
            <div class="flex items-center gap-3">
              <span :class="statusDot(meso.status)" class="w-2 h-2 rounded-full flex-shrink-0"></span>
              <div>
                <p class="text-sm font-medium text-ink-2">{{ meso.name }}</p>
                <p class="text-xs text-ink-3">{{ formatDate(meso.start_date) }}<span v-if="meso.end_date"> → {{ formatDate(meso.end_date) }}</span></p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-xs text-ink-3">{{ meso._count.workouts }} entrenos</span>
              <span :class="statusBadge(meso.status)" class="text-xs font-medium px-2 py-0.5 rounded-full capitalize">{{ statusLabel(meso.status) }}</span>
            </div>
          </NuxtLink>
        </div>
        <div v-else class="px-6 py-4 text-sm text-ink-3 italic">
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
  ({ active: 'bg-positive/10 text-positive', paused: 'bg-warn/10 text-warn', completed: 'bg-surface-2 text-ink-3' }[s] ?? 'bg-surface-2 text-ink-3')

const statusDot = (s: string) =>
  ({ active: 'bg-positive', paused: 'bg-warn', completed: 'bg-surface-2' }[s] ?? 'bg-surface-2')
</script>
