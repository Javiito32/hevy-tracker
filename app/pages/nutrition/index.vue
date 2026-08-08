<template>
  <div class="max-w-5xl mx-auto pb-24">
    <div class="flex flex-wrap gap-3 justify-between items-center mb-6">
      <div>
        <h1 class="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] text-ink leading-none">Nutrición</h1>
        <p class="text-sm text-ink-3 mt-1">Diseña tu dieta y guarda el histórico de cada cambio.</p>
      </div>
      <div class="flex gap-2">
        <NuxtLink
          to="/nutrition/foods"
          class="bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2 px-4 py-2 rounded-lg transition text-sm font-medium"
        >
          Alimentos
        </NuxtLink>
        <NuxtLink
          v-if="data?.plan"
          to="/nutrition/history"
          class="bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2 px-4 py-2 rounded-lg transition text-sm font-medium"
        >
          Histórico
        </NuxtLink>
      </div>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <UiSpinner size="lg" class="text-ink-3" />
    </div>

    <!-- Sin dieta -->
    <div v-else-if="!data?.plan" class="bg-surface rounded-card border border-line p-10 text-center text-ink-3">
      <p class="mb-1 text-sm">Todavía no tienes ninguna dieta.</p>
      <p class="mb-5 text-xs text-ink-3">
        Cada vez que la modifiques y publiques, se guardará una versión con su fecha,
        de modo que siempre podrás consultar qué comías en cualquier momento pasado.
      </p>
      <button
        @click="showPlanForm = true"
        class="inline-block bg-accent text-accent-ink px-4 py-2 rounded-lg hover:opacity-85 transition text-sm"
      >
        Crear mi dieta
      </button>
    </div>

    <template v-else>
      <!-- Cabecera del plan -->
      <div class="bg-surface rounded-card border border-line p-6 mb-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h2 class="text-xl font-semibold text-ink">{{ data.plan.name }}</h2>
              <span v-if="data.plan.goal" class="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-ink-2">
                {{ GOAL_LABELS[data.plan.goal] ?? data.plan.goal }}
              </span>
            </div>
            <p v-if="data.plan.notes" class="text-sm text-ink-3 mt-2">{{ data.plan.notes }}</p>
          </div>

          <div v-if="shown" class="text-right">
            <span class="text-xs px-2 py-0.5 rounded-full" :class="VERSION_STATUS_BADGES[shown.status]">
              v{{ shown.version_number }} · {{ VERSION_STATUS_LABELS[shown.status] }}
            </span>
            <p v-if="shown.start_date" class="text-xs text-ink-3 mt-1.5">
              Desde el {{ formatDateShort(shown.start_date) }}
            </p>
          </div>
        </div>
      </div>

      <!-- Aviso de borrador -->
      <div v-if="isDraft" class="bg-warn/10 border border-warn/40 rounded-card px-5 py-3 mb-6 text-sm text-warn">
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
          <h2 class="text-sm font-semibold text-ink-2 uppercase tracking-wider">Comidas</h2>
          <button
            v-if="!isDraft"
            @click="startEditing"
            :disabled="working"
            class="bg-accent text-accent-ink px-4 py-2 rounded-lg hover:opacity-85 transition text-sm font-medium disabled:opacity-60"
          >
            {{ working ? 'Abriendo...' : '✎ Editar dieta' }}
          </button>
        </div>

        <div v-if="!shown.meals.length" class="bg-surface rounded-card border border-line p-8 text-center text-sm text-ink-3">
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
          class="w-full border border-dashed border-line-strong rounded-card py-3 text-sm text-ink-3 hover:text-ink-2 hover:border-line-strong transition"
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
          class="fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur-md border-t border-warn/40"
        >
          <div class="container mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-warn">
              Cambios sin publicar en el borrador v{{ shown?.version_number }}
            </span>
            <div class="flex gap-2">
              <button
                @click="discardDraft"
                :disabled="working"
                class="px-4 py-2 text-sm text-ink-2 hover:text-ink transition disabled:opacity-60"
              >
                Descartar
              </button>
              <button
                @click="showPublishForm = true"
                :disabled="working"
                class="px-5 py-2 bg-accent text-accent-ink hover:opacity-85 text-sm font-semibold rounded-lg transition disabled:opacity-60"
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
        <div v-if="showPlanForm" class="fixed inset-0 bg-bg/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4" @click.self="showPlanForm = false">
          <div class="bg-surface border border-line-strong rounded-card w-full max-w-lg p-6">
            <h3 class="font-semibold text-ink mb-4">Nueva dieta</h3>
            <form @submit.prevent="createPlan" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-ink-2 mb-1.5">Nombre *</label>
                <input v-model="planForm.name" type="text" required :class="INPUT" placeholder="Ej: Volumen invierno 2026" />
              </div>
              <div>
                <label class="block text-sm font-medium text-ink-2 mb-1.5">Objetivo</label>
                <select v-model="planForm.goal" :class="INPUT">
                  <option value="">Sin especificar</option>
                  <option v-for="(label, value) in GOAL_LABELS" :key="value" :value="value">{{ label }}</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-ink-2 mb-1.5">Notas</label>
                <textarea v-model="planForm.notes" rows="2" :class="INPUT" placeholder="Contexto, restricciones..."></textarea>
              </div>
              <p class="text-xs text-ink-3">
                Se creará con las comidas habituales (desayuno, comida, merienda y cena) como borrador.
                Podrás añadir alimentos y publicarla cuando esté lista.
              </p>
              <div class="flex justify-end gap-3 pt-2">
                <button type="button" @click="showPlanForm = false" class="px-4 py-2 text-sm text-ink-2 hover:text-ink transition">Cancelar</button>
                <button type="submit" :disabled="working" class="px-4 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 disabled:opacity-50 transition">
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
        <div v-if="showPublishForm" class="fixed inset-0 bg-bg/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4" @click.self="showPublishForm = false">
          <div class="bg-surface border border-line-strong rounded-card w-full max-w-lg p-6">
            <h3 class="font-semibold text-ink mb-1">Publicar la dieta</h3>
            <p class="text-xs text-ink-3 mb-4">
              Pasará a ser la dieta vigente desde hoy y quedará congelada en el histórico.
            </p>
            <form @submit.prevent="publishDraft" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-ink-2 mb-1.5">¿Qué has cambiado?</label>
                <input v-model="publishForm.change_note" type="text" :class="INPUT" placeholder="Ej: subo carbos en días de entreno" />
              </div>
              <div>
                <p class="text-xs font-medium text-ink-3 uppercase tracking-wider mb-2">Objetivos diarios (opcional)</p>
                <div class="grid grid-cols-4 gap-2">
                  <div v-for="key in MACRO_KEYS" :key="key">
                    <label class="block text-xs text-ink-3 mb-1">{{ NUTRIENT_SHORT_LABELS[key] }}</label>
                    <input v-model="publishForm[targetKey(key)]" type="number" min="0" step="1" :class="INPUT" placeholder="—" />
                  </div>
                </div>
              </div>
              <div v-if="error" class="bg-danger/10 border border-danger/40 text-danger px-4 py-3 rounded-lg text-sm">{{ error }}</div>
              <div class="flex justify-end gap-3 pt-2">
                <button type="button" @click="showPublishForm = false" class="px-4 py-2 text-sm text-ink-2 hover:text-ink transition">Cancelar</button>
                <button type="submit" :disabled="working" class="px-5 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 disabled:opacity-50 transition">
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

const toast = useToast()

const INPUT =
  'w-full bg-surface-2 border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition'

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
    toast.error(err?.data?.statusMessage || 'Error al crear la dieta.')
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
    toast.error(err?.data?.statusMessage || 'Error al abrir el borrador.')
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
    toast.error(err?.data?.statusMessage || 'Error al descartar el borrador.')
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
    toast.error(err?.data?.statusMessage || 'Error al añadir la comida.')
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
