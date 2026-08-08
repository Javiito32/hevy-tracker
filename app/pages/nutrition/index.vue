<template>
  <div class="max-w-5xl mx-auto pb-24">
    <div class="flex flex-wrap gap-3 justify-between items-center mb-6">
      <div>
        <h1 class="text-3xl font-bold text-slate-100">Nutrición</h1>
        <p class="text-sm text-slate-500 mt-1">Diseña tu dieta y guarda el histórico de cada cambio.</p>
      </div>
      <div class="flex gap-2">
        <NuxtLink
          to="/nutrition/foods"
          class="bg-slate-800 border border-slate-700 text-slate-300 px-4 py-2 rounded-lg hover:bg-slate-700 transition text-sm font-medium"
        >
          Alimentos
        </NuxtLink>
        <NuxtLink
          v-if="data?.plan"
          to="/nutrition/history"
          class="bg-slate-800 border border-slate-700 text-slate-300 px-4 py-2 rounded-lg hover:bg-slate-700 transition text-sm font-medium"
        >
          Histórico
        </NuxtLink>
      </div>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent"></div>
    </div>

    <!-- Sin dieta -->
    <div v-else-if="!data?.plan" class="bg-slate-900 rounded-xl border border-slate-800 p-10 text-center text-slate-500">
      <p class="mb-1 text-sm">Todavía no tienes ninguna dieta.</p>
      <p class="mb-5 text-xs text-slate-600">
        Cada vez que la modifiques y publiques, se guardará una versión con su fecha,
        de modo que siempre podrás consultar qué comías en cualquier momento pasado.
      </p>
      <button
        @click="showPlanForm = true"
        class="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 transition text-sm"
      >
        Crear mi dieta
      </button>
    </div>

    <template v-else>
      <!-- Cabecera del plan -->
      <div class="bg-slate-900 rounded-xl border border-slate-800 p-6 mb-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-xl font-semibold text-slate-100">{{ data.plan.name }}</h2>
              <span v-if="data.plan.goal" class="text-xs px-2 py-0.5 rounded-full bg-indigo-950/60 text-indigo-400">
                {{ GOAL_LABELS[data.plan.goal] ?? data.plan.goal }}
              </span>
            </div>
            <p v-if="data.plan.notes" class="text-sm text-slate-500 mt-2">{{ data.plan.notes }}</p>
          </div>

          <div v-if="shown" class="text-right">
            <span class="text-xs px-2 py-0.5 rounded-full" :class="VERSION_STATUS_BADGES[shown.status]">
              v{{ shown.version_number }} · {{ VERSION_STATUS_LABELS[shown.status] }}
            </span>
            <p v-if="shown.start_date" class="text-xs text-slate-600 mt-1.5">
              Desde el {{ formatDateShort(shown.start_date) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Aviso de borrador -->
      <div v-if="isDraft" class="bg-amber-950/40 border border-amber-800/60 rounded-xl px-5 py-3 mb-6 text-sm text-amber-300">
        Estás editando un borrador. La dieta que sigues ahora mismo no cambia hasta que lo publiques.
      </div>

      <div v-if="shown" class="space-y-6">
        <NutritionNutrientTotals
          :totals="shown.totals"
          :targets="shown.targets"
          :macro-split="shown.macro_split"
          :protein-per-kg="shown.protein_g_per_kg"
          :has-day-split="shown.has_day_split"
        />

        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider">Comidas</h2>
          <button
            v-if="!isDraft"
            @click="startEditing"
            :disabled="working"
            class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 transition text-sm font-medium disabled:opacity-60"
          >
            {{ working ? 'Abriendo...' : '✎ Editar dieta' }}
          </button>
        </div>

        <div v-if="!shown.meals.length" class="bg-slate-900 rounded-xl border border-slate-800 p-8 text-center text-sm text-slate-600">
          Esta versión no tiene comidas.
        </div>

        <NutritionMealEditor
          v-for="meal in shown.meals"
          :key="meal.id"
          :meal="meal"
          :editable="isDraft"
          @add-food="openAddFood"
          @delete-meal="deleteMeal"
          @delete-item="deleteItem"
          @changed="refresh"
        />

        <button
          v-if="isDraft"
          @click="addMeal"
          class="w-full border border-dashed border-slate-700 rounded-xl py-3 text-sm text-slate-500 hover:text-slate-300 hover:border-slate-600 transition"
        >
          + Añadir comida
        </button>

        <NutritionAiPanel v-if="!isDraft && shown.status === 'active'" :plan="data.plan" @applied="refresh" />
      </div>
    </template>

    <!-- Barra fija de cambios sin publicar -->
    <ClientOnly>
      <Teleport to="body">
        <div
          v-if="isDraft"
          class="fixed bottom-0 inset-x-0 z-40 bg-slate-900/95 backdrop-blur-md border-t border-amber-800/60"
        >
          <div class="container mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-amber-300">
              Cambios sin publicar en el borrador v{{ shown?.version_number }}
            </span>
            <div class="flex gap-2">
              <button
                @click="discardDraft"
                :disabled="working"
                class="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition disabled:opacity-60"
              >
                Descartar
              </button>
              <button
                @click="showPublishForm = true"
                :disabled="working"
                class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-60"
              >
                Publicar
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </ClientOnly>

    <!-- Crear dieta -->
    <ClientOnly>
      <Teleport to="body">
        <div v-if="showPlanForm" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" @click.self="showPlanForm = false">
          <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6">
            <h3 class="font-semibold text-slate-100 mb-4">Nueva dieta</h3>
            <form @submit.prevent="createPlan" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-slate-400 mb-1.5">Nombre *</label>
                <input v-model="planForm.name" type="text" required :class="INPUT" placeholder="Ej: Volumen invierno 2026" />
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-400 mb-1.5">Objetivo</label>
                <select v-model="planForm.goal" :class="INPUT">
                  <option value="">Sin especificar</option>
                  <option v-for="(label, value) in GOAL_LABELS" :key="value" :value="value">{{ label }}</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-400 mb-1.5">Notas</label>
                <textarea v-model="planForm.notes" rows="2" :class="INPUT" placeholder="Contexto, restricciones..."></textarea>
              </div>
              <p class="text-xs text-slate-600">
                Se creará con las comidas habituales (desayuno, comida, merienda y cena) como borrador.
                Podrás añadir alimentos y publicarla cuando esté lista.
              </p>
              <div class="flex justify-end gap-3 pt-2">
                <button type="button" @click="showPlanForm = false" class="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition">Cancelar</button>
                <button type="submit" :disabled="working" class="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-500 disabled:opacity-50 transition">
                  {{ working ? 'Creando...' : 'Crear dieta' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Teleport>
    </ClientOnly>

    <!-- Publicar -->
    <ClientOnly>
      <Teleport to="body">
        <div v-if="showPublishForm" class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" @click.self="showPublishForm = false">
          <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6">
            <h3 class="font-semibold text-slate-100 mb-1">Publicar la dieta</h3>
            <p class="text-xs text-slate-500 mb-4">
              Pasará a ser la dieta vigente desde hoy y quedará congelada en el histórico.
            </p>
            <form @submit.prevent="publishDraft" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-slate-400 mb-1.5">¿Qué has cambiado?</label>
                <input v-model="publishForm.change_note" type="text" :class="INPUT" placeholder="Ej: subo carbos en días de entreno" />
              </div>
              <div>
                <p class="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Objetivos diarios (opcional)</p>
                <div class="grid grid-cols-4 gap-2">
                  <div v-for="key in MACRO_KEYS" :key="key">
                    <label class="block text-xs text-slate-500 mb-1">{{ NUTRIENT_SHORT_LABELS[key] }}</label>
                    <input v-model="publishForm[targetKey(key)]" type="number" min="0" step="1" :class="INPUT" placeholder="—" />
                  </div>
                </div>
              </div>
              <div v-if="error" class="bg-rose-950/60 border border-rose-800 text-rose-400 px-4 py-3 rounded-lg text-sm">{{ error }}</div>
              <div class="flex justify-end gap-3 pt-2">
                <button type="button" @click="showPublishForm = false" class="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition">Cancelar</button>
                <button type="submit" :disabled="working" class="px-5 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-500 disabled:opacity-50 transition">
                  {{ working ? 'Publicando...' : 'Publicar' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Teleport>
    </ClientOnly>

    <NutritionAddFoodModal
      :open="addFoodOpen"
      :meal="addFoodMeal"
      @close="addFoodOpen = false"
      @added="onFoodAdded"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'

const INPUT =
  'w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition'

const { data, pending, refresh } = useFetch<any>('/api/nutrition/plans')

const working = ref(false)
const error = ref('')
const showPlanForm = ref(false)
const showPublishForm = ref(false)
const addFoodOpen = ref(false)
const addFoodMeal = ref<any | null>(null)

const planForm = reactive({ name: '', goal: '', notes: '' })
const publishForm = reactive<Record<string, any>>({
  change_note: '',
  target_kcal: '',
  target_protein_g: '',
  target_carbs_g: '',
  target_fat_g: ''
})

/**
 * The draft always wins: coming back to the page must resume unpublished work
 * rather than silently showing the published diet and hiding it.
 */
const shown = computed(() => data.value?.draft ?? data.value?.active ?? null)
const isDraft = computed(() => shown.value?.status === 'draft')

const targetKey = (key: string) => `target_${key === 'kcal' ? 'kcal' : key}`

const createPlan = async () => {
  working.value = true
  try {
    await $fetch('/api/nutrition/plans', { method: 'POST', body: { ...planForm } })
    showPlanForm.value = false
    Object.assign(planForm, { name: '', goal: '', notes: '' })
    await refresh()
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Error al crear la dieta.')
  } finally {
    working.value = false
  }
}

/** Forks the active version into a draft. Idempotent server-side. */
const startEditing = async () => {
  working.value = true
  try {
    await $fetch(`/api/nutrition/plans/${data.value.plan.id}/draft`, { method: 'POST' })
    await refresh()
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Error al abrir el borrador.')
  } finally {
    working.value = false
  }
}

const publishDraft = async () => {
  working.value = true
  error.value = ''
  try {
    await $fetch(`/api/nutrition/versions/${shown.value.id}/publish`, {
      method: 'POST',
      body: { ...publishForm }
    })
    showPublishForm.value = false
    Object.assign(publishForm, {
      change_note: '',
      target_kcal: '',
      target_protein_g: '',
      target_carbs_g: '',
      target_fat_g: ''
    })
    await refresh()
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Error al publicar la dieta.'
  } finally {
    working.value = false
  }
}

const discardDraft = async () => {
  if (!confirm('¿Descartar el borrador y volver a la dieta publicada?')) return
  working.value = true
  try {
    await $fetch(`/api/nutrition/versions/${shown.value.id}/discard`, { method: 'DELETE' })
    await refresh()
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Error al descartar el borrador.')
  } finally {
    working.value = false
  }
}

const addMeal = async () => {
  const name = prompt('Nombre de la comida:', 'Media mañana')
  if (!name?.trim()) return
  try {
    await $fetch('/api/nutrition/meals', {
      method: 'POST',
      body: { diet_version_id: shown.value.id, name: name.trim() }
    })
    await refresh()
  } catch (err: any) {
    alert(err?.data?.statusMessage || 'Error al añadir la comida.')
  }
}

const deleteMeal = async (meal: any) => {
  if (!confirm(`¿Eliminar "${meal.name}" y todos sus alimentos?`)) return
  await $fetch(`/api/nutrition/meals/${meal.id}`, { method: 'DELETE' })
  await refresh()
}

const deleteItem = async (item: any) => {
  await $fetch(`/api/nutrition/items/${item.id}`, { method: 'DELETE' })
  await refresh()
}

const openAddFood = (meal: any) => {
  addFoodMeal.value = meal
  addFoodOpen.value = true
}

const onFoodAdded = async () => {
  addFoodOpen.value = false
  await refresh()
}
</script>
