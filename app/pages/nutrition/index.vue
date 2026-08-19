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
        <button
          v-if="shown"
          type="button"
          :disabled="downloadingPdf"
          title="Descarga el menú de lunes a domingo"
          class="bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2 px-4 py-2 rounded-lg transition text-sm font-medium disabled:opacity-45 disabled:cursor-not-allowed"
          @click="downloadPdf"
        >
          {{ downloadingPdf ? 'Generando…' : 'PDF de la semana' }}
        </button>
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
        <NutritionWeekStrip v-model="selectedWeekday" :days="shown.days" />

        <NutritionNutrientTotals
          :days="shown.days"
          :weekday="selectedWeekday"
          :average="shown.totals.average"
          :average-coverage="shown.totals.average_coverage"
          :average-macro-split="shown.macro_split"
          :average-protein-per-kg="shown.protein_g_per_kg"
          :planned-days="shown.planned_days"
          :targets="shown.targets"
        />

        <div class="flex items-center justify-between gap-3 flex-wrap">
          <h2 class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3">
            Comidas del {{ WEEKDAY_LABELS[selectedWeekday].toLowerCase() }}
          </h2>
          <div class="flex gap-2">
            <UiButton v-if="isDraft" variant="secondary" size="sm" @click="openDayTarget">
              ◎ Objetivo del día
            </UiButton>
            <UiButton v-if="isDraft && mealsOfDay.length" variant="secondary" size="sm" @click="openCopyFrom">
              ⧉ Copiar a…
            </UiButton>
            <UiButton v-if="!isDraft" :loading="working" @click="startEditing">✎ Editar dieta</UiButton>
          </div>
        </div>

        <!-- An empty day offers to pull from another one: from here the natural
             verb is "bring", not "send", and it is the same endpoint reversed. -->
        <div v-if="!mealsOfDay.length" class="bg-surface rounded-card border border-line p-8 text-center">
          <p class="text-sm text-ink-3">No hay comidas el {{ WEEKDAY_LABELS[selectedWeekday].toLowerCase() }}.</p>
          <div v-if="isDraft" class="flex justify-center gap-2 mt-4">
            <UiButton size="sm" @click="showMealForm = true">+ Añadir comida</UiButton>
            <UiButton variant="secondary" size="sm" @click="openCopyInto">⧉ Copiar otro día aquí</UiButton>
          </div>
        </div>

        <NutritionMealEditor
          v-for="meal in mealsOfDay"
          :key="meal.id"
          :meal="meal"
          :editable="isDraft"
          @add-food="openAddFood"
          @delete-meal="deleteMeal"
          @delete-item="deleteItem"
          @changed="refresh"
        />

        <button
          v-if="isDraft && mealsOfDay.length"
          @click="showMealForm = true"
          class="w-full border border-dashed border-line-strong rounded-card py-3 text-sm text-ink-3 hover:text-ink-2 hover:border-line-strong transition"
        >
          + Añadir comida al {{ WEEKDAY_LABELS[selectedWeekday].toLowerCase() }}
        </button>

        <NutritionAiPanel v-if="!isDraft && shown.status === 'active'" :plan="data.plan" @applied="refresh" />
      </div>
    </template>

    <!-- Nueva comida. Sustituye a un prompt() nativo, que además de no seguir el
         sistema visual no puede llevar la hora ni decir a qué día va. -->
    <UiModal
      :open="showMealForm"
      title="Nueva comida"
      :hint="`Se añadirá al ${WEEKDAY_LABELS[selectedWeekday]?.toLowerCase()}.`"
      size="sm"
      @close="showMealForm = false"
    >
      <form id="meal-form" class="space-y-4" @submit.prevent="addMeal">
        <UiField label="Nombre" required>
          <template #default="{ id }">
            <UiInput :id="id" v-model="mealForm.name" required placeholder="Ej: Media mañana" />
          </template>
        </UiField>
        <UiField label="Hora" hint="Opcional. Es solo una etiqueta en el plan.">
          <template #default="{ id }">
            <UiInput :id="id" v-model="mealForm.time_of_day" type="time" />
          </template>
        </UiField>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="showMealForm = false">Cancelar</UiButton>
        <UiButton type="submit" form="meal-form" :loading="working">Añadir</UiButton>
      </template>
    </UiModal>

    <NutritionCopyDayModal
      v-if="shown"
      :open="showCopyDay"
      :version-id="shown.id"
      :days="shown.days"
      :default-from="copyFrom"
      :default-to="copyTo"
      @close="showCopyDay = false"
      @copied="onCopied"
    />

    <NutritionDayTargetModal
      v-if="shown && currentDay"
      :open="showDayTarget"
      :version-id="shown.id"
      :weekday="selectedWeekday"
      :base-targets="shown.targets"
      :day-target="currentDay.target"
      @close="showDayTarget = false"
      @saved="onTargetSaved"
    />

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
                @click="openPublish"
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
                Se creará como borrador con las comidas habituales (desayuno, comida, merienda y cena)
                en los siete días de la semana. Cada día es independiente: puedes rellenar uno y copiarlo
                al resto, o darle a cada uno su propio menú.
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
                <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-2">Objetivos diarios (opcional)</p>
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
const downloadingPdf = ref(false)
const error = ref('')
const showPlanForm = ref(false)
const showPublishForm = ref(false)
const showMealForm = ref(false)
const showCopyDay = ref(false)
const showDayTarget = ref(false)
const copyFrom = ref(1)
const copyTo = ref<number[]>([])
const addFoodOpen = ref(false)
const addFoodMeal = ref<any | null>(null)

const mealForm = reactive({ name: '', time_of_day: '' })

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

/**
 * The selected weekday lives in the URL (`?dia=3`), as the admin panel's tab
 * does. It matters more here: adding a food goes through a modal and a refresh,
 * and publishing reloads the whole version — losing the day mid-edit and being
 * thrown back to Monday would be actively hostile. Defaults to today.
 */
const route = useRoute()
const router = useRouter()

const selectedWeekday = computed<number>({
  get: () => {
    const value = Number(route.query.dia)
    return isWeekday(value) ? value : todayWeekday()
  },
  set: (weekday) => {
    router.replace({ query: { ...route.query, dia: String(weekday) } })
  }
})

const mealsOfDay = computed(() =>
  (shown.value?.meals ?? []).filter((m: any) => m.weekday === selectedWeekday.value)
)

const currentDay = computed(() =>
  (shown.value?.days ?? []).find((d: any) => d.weekday === selectedWeekday.value) ?? null
)

const targetKey = (key: string) => `target_${key === 'kcal' ? 'kcal' : key}`

const openCopyFrom = () => {
  copyFrom.value = selectedWeekday.value
  copyTo.value = []
  showCopyDay.value = true
}

/** From an empty day, the source is what you pick and this day is the target. */
const openCopyInto = () => {
  const firstPlanned = (shown.value?.days ?? []).find((d: any) => d.meals_count > 0)
  copyFrom.value = firstPlanned?.weekday ?? 1
  copyTo.value = [selectedWeekday.value]
  showCopyDay.value = true
}

const openDayTarget = () => { showDayTarget.value = true }

const onCopied = async () => {
  showCopyDay.value = false
  await refresh()
}

const onTargetSaved = async () => {
  showDayTarget.value = false
  await refresh()
}

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

const openPublish = () => {
  const t = shown.value?.targets
  publishForm.change_note = ''
  publishForm.target_kcal = t?.kcal ?? ''
  publishForm.target_protein_g = t?.protein_g ?? ''
  publishForm.target_carbs_g = t?.carbs_g ?? ''
  publishForm.target_fat_g = t?.fat_g ?? ''
  showPublishForm.value = true
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
  if (!mealForm.name.trim()) return
  working.value = true
  try {
    await $fetch('/api/nutrition/meals', {
      method: 'POST',
      body: {
        diet_version_id: shown.value.id,
        name: mealForm.name.trim(),
        time_of_day: mealForm.time_of_day || null,
        // Required by the endpoint: a missing weekday is a 400, not a meal that
        // quietly lands on Monday while the user watches this tab not change.
        weekday: selectedWeekday.value
      }
    })
    showMealForm.value = false
    Object.assign(mealForm, { name: '', time_of_day: '' })
    await refresh()
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'Error al añadir la comida.')
  } finally {
    working.value = false
  }
}

const deleteMeal = async (meal: any) => {
  if (!confirm(`¿Eliminar "${meal.name}" del ${WEEKDAY_LABELS[meal.weekday]?.toLowerCase()} y todos sus alimentos?`)) return
  try {
    await $fetch(`/api/nutrition/meals/${meal.id}`, { method: 'DELETE' })
    await refresh()
  } catch {
    toast.error('No se pudo eliminar la comida.')
  }
}

const deleteItem = async (item: any) => {
  try {
    await $fetch(`/api/nutrition/items/${item.id}`, { method: 'DELETE' })
    await refresh()
  } catch {
    toast.error('No se pudo quitar el alimento.')
  }
}

const openAddFood = (meal: any) => {
  addFoodMeal.value = meal
  addFoodOpen.value = true
}

const onFoodAdded = async () => {
  addFoodOpen.value = false
  await refresh()
}

const downloadPdf = async () => {
  if (!shown.value || downloadingPdf.value) return
  downloadingPdf.value = true
  try {
    const blob = await $fetch<Blob>(`/api/nutrition/versions/${shown.value.id}/pdf`, {
      responseType: 'blob'
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = pdfFilename()
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'No se ha podido generar el PDF.')
  } finally {
    downloadingPdf.value = false
  }
}

/** Mirrors `dietPdfFilename` on the server — the body is a blob, so the
 *  Content-Disposition name never reaches the <a download> attribute. */
const pdfFilename = () => {
  const name = (data.value?.plan?.name || 'dieta')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'dieta'
  return `${name}-v${shown.value?.version_number ?? 1}.pdf`
}
</script>
