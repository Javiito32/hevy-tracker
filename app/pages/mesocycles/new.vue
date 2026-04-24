<template>
  <div class="max-w-3xl mx-auto">
    <div class="mb-6 flex items-center">
      <NuxtLink to="/mesocycles" class="text-blue-600 hover:underline mr-4">← Volver</NuxtLink>
      <h1 class="text-3xl font-bold text-gray-800">Crear Mesociclo</h1>
    </div>

    <!-- AI Generation Panel -->
    <div class="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-5 mb-6">
      <div class="flex items-center gap-2 mb-4">
        <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
        </svg>
        <h2 class="font-semibold text-gray-800">Generar plan con IA</h2>
        <span class="text-xs text-gray-500 hidden sm:inline">— Describe tu objetivo y la IA rellena el formulario</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div class="sm:col-span-3">
          <input
            v-model="aiGoal"
            type="text"
            placeholder="Objetivo principal (ej. hipertrofia máxima, ganar fuerza en sentadilla...)"
            class="w-full border border-blue-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>
        <div>
          <label class="block text-xs text-gray-600 mb-1">Días/semana</label>
          <input v-model.number="aiDays" type="number" min="1" max="7" class="w-full border border-blue-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div>
          <label class="block text-xs text-gray-600 mb-1">Duración (semanas)</label>
          <input v-model.number="aiWeeks" type="number" min="2" max="24" class="w-full border border-blue-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
        <div>
          <label class="block text-xs text-gray-600 mb-1">Equipamiento (opcional)</label>
          <input v-model="aiEquipment" type="text" placeholder="ej. gimnasio completo, solo mancuernas..." class="w-full border border-blue-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />
        </div>
      </div>
      <button
        @click="generateWithAI"
        :disabled="!aiGoal || !aiDays || !aiWeeks || generating"
        class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition"
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
      <p v-if="generateError" class="text-xs text-red-600 mt-2">{{ generateError }}</p>
    </div>

    <!-- Main Form -->
    <div class="bg-white rounded-lg shadow p-6">
      <form @submit.prevent="handleSubmit" class="space-y-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
          <input
            v-model="form.name"
            type="text"
            placeholder="ej. Winter Hypertrophy Block v1"
            class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Fecha de inicio *</label>
            <input
              v-model="form.start_date"
              type="date"
              class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Fecha de fin (Opcional)</label>
            <input
              v-model="form.end_date"
              type="date"
              class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Objetivo</label>
          <textarea
            v-model="form.goal"
            rows="2"
            placeholder="Definición general de lo que quieres lograr"
            class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          ></textarea>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Split / Descripción de rutina</label>
          <textarea
            v-model="form.split_description"
            rows="8"
            placeholder="Describe tu split en formato narrativo... ej. Lunes - Pecho & Tríceps..."
            class="w-full border border-gray-300 rounded px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          ></textarea>
          <p class="text-xs text-gray-500 mt-1">La IA utilizará esto para entender tu contexto de entrenamiento.</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Objetivo de entrenamientos por semana</label>
          <input
            v-model.number="form.target_volume_weekly"
            type="number"
            min="1"
            max="14"
            class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p class="text-xs text-gray-500 mt-1">Se usa en el dashboard para mostrar tu progreso semanal.</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Notas adicionales</label>
          <textarea
            v-model="form.notes"
            rows="2"
            placeholder="Cualquier nota adicional sobre este bloque..."
            class="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          ></textarea>
        </div>

        <!-- AI Feedback Section -->
        <div class="pt-4 border-t border-gray-200">
          <div class="flex items-center gap-3">
            <button
              type="button"
              @click="analyzeWithAI"
              :disabled="!hasEnoughData || analyzingFeedback"
              class="flex items-center gap-2 text-sm px-3 py-1.5 border border-purple-300 text-purple-700 rounded hover:bg-purple-50 disabled:opacity-40 transition"
            >
              <svg v-if="analyzingFeedback" class="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {{ analyzingFeedback ? 'Analizando...' : 'Analizar plan con IA' }}
            </button>
            <span v-if="!hasEnoughData" class="text-xs text-gray-400">Rellena al menos el objetivo y el split para analizar.</span>
          </div>

          <div v-if="aiFeedback" class="mt-4 bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-semibold text-purple-800">Análisis de la IA</span>
              <button type="button" @click="aiFeedback = ''" class="text-xs text-purple-400 hover:text-purple-600">✕ Cerrar</button>
            </div>
            <div class="text-sm text-gray-700 space-y-1" v-html="renderMarkdown(aiFeedback)"></div>
          </div>
          <p v-if="feedbackError" class="text-xs text-red-600 mt-2">{{ feedbackError }}</p>
        </div>

        <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
          {{ error }}
        </div>

        <div class="flex justify-end space-x-3 pt-4 border-t">
          <NuxtLink to="/mesocycles" class="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50">
            Cancelar
          </NuxtLink>
          <button
            type="submit"
            :disabled="saving"
            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center"
          >
            <svg v-if="saving" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
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
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const today = new Date().toISOString().split('T')[0]

const form = ref({
  name: '',
  start_date: today,
  end_date: '',
  goal: '',
  split_description: '',
  target_volume_weekly: 4,
  notes: ''
})

const saving = ref(false)
const error = ref('')

// AI generate
const aiGoal = ref('')
const aiDays = ref(4)
const aiWeeks = ref(8)
const aiEquipment = ref('')
const generating = ref(false)
const generateError = ref('')

// AI feedback
const analyzingFeedback = ref(false)
const aiFeedback = ref('')
const feedbackError = ref('')

const hasEnoughData = computed(() => !!(form.value.goal && form.value.split_description))

const generateWithAI = async () => {
  generating.value = true
  generateError.value = ''
  try {
    const result = await $fetch<{ plan: any }>('/api/mesocycles/ai-generate', {
      method: 'POST',
      body: {
        goal: aiGoal.value,
        days_per_week: aiDays.value,
        duration_weeks: aiWeeks.value,
        equipment: aiEquipment.value || undefined
      }
    })
    const plan = result.plan
    if (plan.name) form.value.name = plan.name
    if (plan.goal) form.value.goal = plan.goal
    if (plan.split_description) form.value.split_description = plan.split_description
    if (plan.target_volume_weekly) form.value.target_volume_weekly = plan.target_volume_weekly
    if (plan.notes) form.value.notes = plan.notes
    const end = new Date(form.value.start_date)
    end.setDate(end.getDate() + aiWeeks.value * 7)
    form.value.end_date = end.toISOString().split('T')[0]
  } catch (err: any) {
    generateError.value = err?.data?.statusMessage || 'Error al generar el plan.'
  } finally {
    generating.value = false
  }
}

const analyzeWithAI = async () => {
  analyzingFeedback.value = true
  feedbackError.value = ''
  aiFeedback.value = ''
  try {
    const durationWeeks = form.value.end_date
      ? Math.round((new Date(form.value.end_date).getTime() - new Date(form.value.start_date).getTime()) / (7 * 24 * 60 * 60 * 1000))
      : undefined
    const result = await $fetch<{ feedback: string }>('/api/mesocycles/ai-feedback', {
      method: 'POST',
      body: {
        name: form.value.name,
        goal: form.value.goal,
        split_description: form.value.split_description,
        target_volume_weekly: form.value.target_volume_weekly,
        duration_weeks: durationWeeks,
        notes: form.value.notes
      }
    })
    aiFeedback.value = result.feedback
  } catch (err: any) {
    feedbackError.value = err?.data?.statusMessage || 'Error al analizar el plan.'
  } finally {
    analyzingFeedback.value = false
  }
}

const renderMarkdown = (text: string): string => {
  return text
    .replace(/^## (.+)$/gm, '<h2 class="font-bold text-gray-900 mt-4 mb-1 text-sm">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="font-semibold text-gray-800 mt-3 mb-1 text-sm">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc text-sm">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal text-sm">$2</li>')
    .replace(/\n\n/g, '<br/>')
}

const handleSubmit = async () => {
  error.value = ''
  saving.value = true
  try {
    await $fetch('/api/mesocycles', {
      method: 'POST',
      body: {
        name: form.value.name,
        start_date: form.value.start_date,
        end_date: form.value.end_date || null,
        goal: form.value.goal,
        split_description: form.value.split_description,
        target_volume_weekly: form.value.target_volume_weekly,
        notes: form.value.notes
      }
    })
    router.push('/mesocycles')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Error al guardar el mesociclo. Inténtalo de nuevo.'
  } finally {
    saving.value = false
  }
}
</script>
