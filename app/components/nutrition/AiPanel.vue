<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
    <div class="px-6 py-4 border-b border-slate-800">
      <h2 class="text-sm font-semibold text-slate-300">Análisis con IA</h2>
      <p class="text-xs text-slate-500 mt-0.5">
        Cruza tu dieta con la carga de entreno, la tendencia de peso y tu objetivo.
      </p>
    </div>

    <div class="p-6 space-y-4">
      <div class="flex flex-wrap gap-2">
        <button
          @click="analyze"
          :disabled="busy"
          class="bg-violet-600 text-white px-5 py-2.5 rounded-lg hover:bg-violet-500 flex items-center transition disabled:opacity-50 text-sm font-medium"
        >
          <span class="mr-2" v-if="loading !== 'analysis'">✨</span>
          <svg v-else class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {{ loading === 'analysis' ? 'Analizando...' : 'Analizar mi dieta' }}
        </button>

        <div class="flex items-center gap-2">
          <select v-model="goal" class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500 transition">
            <option v-for="(label, value) in GOAL_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
          <button
            @click="requestTargets"
            :disabled="busy"
            class="bg-slate-800 border border-violet-800 text-violet-300 px-4 py-2.5 rounded-lg hover:bg-slate-700 transition disabled:opacity-50 text-sm font-medium"
          >
            {{ loading === 'targets' ? 'Calculando...' : 'Recomendar objetivos' }}
          </button>
        </div>
      </div>

      <div v-if="error" class="bg-rose-950/60 border border-rose-800 text-rose-400 px-4 py-3 rounded-lg text-sm">
        {{ error }}
      </div>

      <!-- Objetivos propuestos -->
      <div v-if="targets" class="bg-violet-950/30 border border-violet-900 rounded-xl p-5 space-y-4">
        <h3 class="text-base font-semibold text-violet-300 flex items-center">
          <span class="mr-2">🎯</span>Objetivos propuestos · {{ GOAL_LABELS[goal] }}
        </h3>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div v-for="key in MACRO_KEYS" :key="key" class="bg-slate-900/60 rounded-lg py-2.5">
            <div class="text-lg text-slate-100">{{ formatNutrientValue(targets[targetField(key)], key) }}</div>
            <div class="text-[10px] text-slate-500 uppercase tracking-wider">{{ NUTRIENT_SHORT_LABELS[key] }}</div>
          </div>
        </div>

        <p v-if="targets.protein_g_per_kg" class="text-xs text-slate-400">
          {{ targets.protein_g_per_kg }} g de proteína por kg de peso corporal.
        </p>

        <p v-if="targets.rationale" class="text-sm text-slate-300">{{ targets.rationale }}</p>

        <ul v-if="targets.adjustments?.length" class="text-sm text-slate-300 space-y-1 list-disc list-inside">
          <li v-for="(adjustment, i) in targets.adjustments" :key="i">{{ adjustment }}</li>
        </ul>

        <div class="flex items-center gap-3 pt-1">
          <button
            @click="applyTargets"
            :disabled="busy"
            class="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-60"
          >
            {{ loading === 'apply' ? 'Aplicando...' : 'Aplicar objetivos' }}
          </button>
          <span class="text-xs text-slate-500">
            Se guardarán en un borrador que deberás publicar.
          </span>
        </div>

        <p v-if="model && isAdmin" class="text-[10px] font-mono text-slate-600">Modelo: {{ model }}</p>
      </div>

      <!-- Análisis en Markdown -->
      <div v-if="analysis" class="bg-violet-950/30 border border-violet-900 rounded-xl p-6 relative overflow-hidden">
        <div class="absolute top-0 left-0 w-1 h-full bg-violet-500"></div>
        <h3 class="text-base font-semibold mb-3 flex items-center text-violet-300">
          <span class="mr-2">✨</span>Análisis de la dieta
        </h3>
        <div class="prose prose-sm prose-invert text-slate-300 max-w-none" v-html="renderMarkdown(analysis)"></div>
        <p v-if="model && isAdmin" class="text-[10px] font-mono text-slate-600 mt-2">Modelo: {{ model }}</p>
        <div class="mt-4 pt-3 border-t border-violet-900">
          <NuxtLink to="/chat" class="text-violet-400 text-sm font-medium hover:text-violet-300 transition">
            Continuar en el Chat →
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ plan: any }>()
const emit = defineEmits<{ applied: [] }>()

const { session } = useUserSession()
const isAdmin = computed(() => (session.value?.user as any)?.role === 'admin')

const goal = ref(props.plan?.goal || 'maintenance')
const loading = ref<'analysis' | 'targets' | 'apply' | null>(null)
const busy = computed(() => loading.value !== null)
const analysis = ref('')
const targets = ref<any | null>(null)
const model = ref('')
const error = ref('')

const targetField = (key: string) => `target_${key}`

const analyze = async () => {
  loading.value = 'analysis'
  error.value = ''
  analysis.value = ''
  try {
    const res = await $fetch<any>('/api/nutrition/ai-analyze', { method: 'POST' })
    analysis.value = res.analysis
    model.value = res.model ?? ''
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Error al conectar con la IA. Verifica la API key en Ajustes.'
  } finally {
    loading.value = null
  }
}

const requestTargets = async () => {
  loading.value = 'targets'
  error.value = ''
  targets.value = null
  try {
    const res = await $fetch<any>('/api/nutrition/ai-targets', { method: 'POST', body: { goal: goal.value } })
    targets.value = res.targets
    model.value = res.model ?? ''
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Error al calcular los objetivos.'
  } finally {
    loading.value = null
  }
}

/**
 * Targets are written onto a draft, never straight onto the published version —
 * the same rule every other edit follows, so nothing enters the history without
 * the user publishing it.
 */
const applyTargets = async () => {
  if (!targets.value) return
  loading.value = 'apply'
  error.value = ''
  try {
    const draft = await $fetch<any>(`/api/nutrition/plans/${props.plan.id}/draft`, { method: 'POST' })
    await $fetch(`/api/nutrition/versions/${draft.id}`, {
      method: 'PATCH',
      body: {
        change_note: `Objetivos recomendados por IA para ${GOAL_LABELS[goal.value] ?? goal.value}`,
        target_kcal: targets.value.target_kcal,
        target_protein_g: targets.value.target_protein_g,
        target_carbs_g: targets.value.target_carbs_g,
        target_fat_g: targets.value.target_fat_g
      }
    })
    targets.value = null
    emit('applied')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Error al aplicar los objetivos.'
  } finally {
    loading.value = null
  }
}
</script>
