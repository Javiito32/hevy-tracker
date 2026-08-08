<template>
  <div class="max-w-6xl mx-auto">
    <UiPageHeader
      eyebrow="Nutrición"
      title="Alimentos"
      subtitle="Tu catálogo. Todos los valores están expresados por 100 g."
    >
      <template #actions>
        <UiButton variant="secondary" size="sm" @click="searchModalOpen = true">Open Food Facts</UiButton>
        <UiButton size="sm" @click="openCreate">Nuevo alimento</UiButton>
      </template>
    </UiPageHeader>

    <div class="mb-4 max-w-md">
      <UiInput
        v-model="search"
        type="search"
        placeholder="Buscar por nombre, marca o código de barras…"
        aria-label="Buscar alimento"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16 text-ink-3">
      <UiSpinner size="lg" />
    </div>

    <UiCard v-else-if="!filtered.length" flush>
      <UiEmptyState
        :title="search ? 'Ningún alimento coincide' : 'Tu catálogo está vacío'"
        :description="search ? 'Prueba con otro nombre, marca o código de barras.' : 'Añade el primer alimento para poder montar la dieta.'"
      >
        <UiButton v-if="!search" size="sm" @click="openCreate">Crear el primero</UiButton>
      </UiEmptyState>
    </UiCard>

    <UiCard v-else eyebrow="Por 100 g" title="Catálogo" flush>
      <template #actions>
        <span class="font-data text-xs text-ink-3">{{ filtered.length }} alimentos</span>
      </template>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-surface-2 border-b border-line text-[11px] text-ink-3 uppercase tracking-wide">
              <th class="px-5 py-2.5 text-left font-semibold">Alimento</th>
              <th class="px-4 py-2.5 text-right font-semibold">kcal</th>
              <th class="px-4 py-2.5 text-right font-semibold">Prot.</th>
              <th class="px-4 py-2.5 text-right font-semibold">Carbs</th>
              <th class="px-4 py-2.5 text-right font-semibold">Grasa</th>
              <th class="px-4 py-2.5 text-right font-semibold">Fibra</th>
              <th class="px-4 py-2.5 text-center font-semibold">Micros</th>
              <th class="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="food in paged"
              :key="food.id"
              @click="openEdit(food)"
              class="border-b border-line hover:bg-surface-2 cursor-pointer transition group"
            >
              <td class="px-5 py-2.5">
                <div class="text-ink">{{ food.name }}</div>
                <div class="text-xs text-ink-3">
                  <span v-if="food.brand">{{ food.brand }}</span>
                  <span v-if="food.brand && food.serving_size_g"> · </span>
                  <span v-if="food.serving_size_g">{{ food.serving_label || 'ración' }} = {{ formatGrams(food.serving_size_g) }}</span>
                  <span v-if="food.source === 'openfoodfacts'" class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-ink-3">OFF</span>
                </div>
              </td>
              <td class="px-4 py-2.5 text-right font-data text-ink-2">{{ formatNutrientValue(food.kcal, 'kcal') }}</td>
              <td class="px-4 py-2.5 text-right font-data text-ink-2">{{ formatNutrientValue(food.protein_g, 'protein_g') }}</td>
              <td class="px-4 py-2.5 text-right font-data text-ink-2">{{ formatNutrientValue(food.carbs_g, 'carbs_g') }}</td>
              <td class="px-4 py-2.5 text-right font-data text-ink-2">{{ formatNutrientValue(food.fat_g, 'fat_g') }}</td>
              <td class="px-4 py-2.5 text-right font-data text-ink-2">{{ formatNutrientValue(food.fiber_g, 'fiber_g') }}</td>
              <td class="px-4 py-2.5 text-center">
                <span class="font-data text-xs" :class="microCount(food) ? 'text-positive' : 'text-ink-3'">
                  {{ microCount(food) ? `${microCount(food)}/12` : NO_VALUE }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-right">
                <button
                  @click.stop="removeFood(food)"
                  class="opacity-0 group-hover:opacity-100 text-ink-3 hover:text-danger transition text-sm"
                  title="Eliminar"
                >
                  🗑
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <template v-if="totalPages > 1" #footer>
        <div class="flex items-center justify-between">
          <span class="font-data">Página {{ page + 1 }} de {{ totalPages }}</span>
          <div class="flex gap-2">
            <UiButton size="sm" variant="secondary" :disabled="page === 0" @click="page = Math.max(0, page - 1)">
              ← Anterior
            </UiButton>
            <UiButton size="sm" variant="secondary" :disabled="page >= totalPages - 1" @click="page = Math.min(totalPages - 1, page + 1)">
              Siguiente →
            </UiButton>
          </div>
        </div>
      </template>
    </UiCard>

    <NutritionFoodFormModal
      :open="modalOpen"
      :food="editing"
      @close="modalOpen = false"
      @saved="onSaved"
    />

    <NutritionFoodSearchModal
      :open="searchModalOpen"
      @close="searchModalOpen = false"
      @imported="onImported"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const PER_PAGE = 20

const { data: foods, pending, refresh } = useFetch<any[]>('/api/nutrition/foods')

const search = ref('')
const page = ref(0)
const modalOpen = ref(false)
const searchModalOpen = ref(false)
const editing = ref<any | null>(null)

const filtered = computed(() => {
  const list = foods.value ?? []
  const q = search.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(f =>
    [f.name, f.brand, f.barcode].some((v: string | null) => v?.toLowerCase().includes(q))
  )
})

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PER_PAGE)))
const paged = computed(() => filtered.value.slice(page.value * PER_PAGE, (page.value + 1) * PER_PAGE))

watch(search, () => { page.value = 0 })

const microCount = (food: any) => MICRO_KEYS.filter(k => food[k] !== null && food[k] !== undefined).length

const openCreate = () => {
  editing.value = null
  modalOpen.value = true
}

const openEdit = (food: any) => {
  editing.value = food
  modalOpen.value = true
}

const onSaved = async () => {
  modalOpen.value = false
  await refresh()
}

const onImported = async () => {
  searchModalOpen.value = false
  await refresh()
}

const removeFood = async (food: any) => {
  if (!confirm(`¿Eliminar "${food.name}" del catálogo?\n\nLas versiones de dieta ya publicadas conservarán sus valores.`)) return
  try {
    await $fetch(`/api/nutrition/foods/${food.id}`, { method: 'DELETE' })
    await refresh()
  } catch (err: any) {
    // Toasts replaced alert() everywhere else in the app; this call site was missed.
    useToast().error(err?.data?.statusMessage || 'No se pudo eliminar el alimento.')
  }
}
</script>
