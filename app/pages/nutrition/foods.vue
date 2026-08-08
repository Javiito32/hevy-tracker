<template>
  <div class="max-w-6xl mx-auto">
    <div class="flex flex-wrap gap-3 justify-between items-center mb-6">
      <div>
        <h1 class="text-3xl font-bold text-slate-100">Alimentos</h1>
        <p class="text-sm text-slate-500 mt-1">Tu catálogo. Todos los valores están expresados por 100 g.</p>
      </div>
      <div class="flex gap-2">
        <button
          @click="searchModalOpen = true"
          class="bg-slate-800 border border-slate-700 text-slate-300 px-4 py-2 rounded-lg hover:bg-slate-700 transition text-sm font-medium"
        >
          🔍 Open Food Facts
        </button>
        <button
          @click="openCreate"
          class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 transition text-sm font-medium"
        >
          + Nuevo alimento
        </button>
      </div>
    </div>

    <div class="mb-5">
      <input
        v-model="search"
        type="search"
        placeholder="Buscar por nombre, marca o código de barras..."
        class="w-full max-w-md bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent"></div>
    </div>

    <div v-else-if="!filtered.length" class="bg-slate-900 rounded-xl border border-slate-800 p-10 text-center text-slate-500">
      <p class="mb-4 text-sm">
        {{ search ? 'Ningún alimento coincide con la búsqueda.' : 'Tu catálogo está vacío. Añade el primer alimento para poder montar la dieta.' }}
      </p>
      <button
        v-if="!search"
        @click="openCreate"
        class="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 transition text-sm"
      >
        Crear el primero
      </button>
    </div>

    <div v-else class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-slate-300">Catálogo</h2>
        <span class="text-xs text-slate-500">{{ filtered.length }} alimentos</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
              <th class="px-6 py-3 text-left">Alimento</th>
              <th class="px-4 py-3 text-right">kcal</th>
              <th class="px-4 py-3 text-right">Prot.</th>
              <th class="px-4 py-3 text-right">Carbs</th>
              <th class="px-4 py-3 text-right">Grasa</th>
              <th class="px-4 py-3 text-right">Fibra</th>
              <th class="px-4 py-3 text-center">Micros</th>
              <th class="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="food in paged"
              :key="food.id"
              @click="openEdit(food)"
              class="border-b border-slate-800/50 hover:bg-slate-800/40 cursor-pointer transition group"
            >
              <td class="px-6 py-3">
                <div class="text-slate-200 font-medium">{{ food.name }}</div>
                <div class="text-xs text-slate-500">
                  <span v-if="food.brand">{{ food.brand }}</span>
                  <span v-if="food.brand && food.serving_size_g"> · </span>
                  <span v-if="food.serving_size_g">{{ food.serving_label || 'ración' }} = {{ formatGrams(food.serving_size_g) }}</span>
                  <span v-if="food.source === 'openfoodfacts'" class="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500">OFF</span>
                </div>
              </td>
              <td class="px-4 py-3 text-right text-slate-300">{{ formatNutrientValue(food.kcal, 'kcal') }}</td>
              <td class="px-4 py-3 text-right text-slate-400">{{ formatNutrientValue(food.protein_g, 'protein_g') }}</td>
              <td class="px-4 py-3 text-right text-slate-400">{{ formatNutrientValue(food.carbs_g, 'carbs_g') }}</td>
              <td class="px-4 py-3 text-right text-slate-400">{{ formatNutrientValue(food.fat_g, 'fat_g') }}</td>
              <td class="px-4 py-3 text-right text-slate-400">{{ formatNutrientValue(food.fiber_g, 'fiber_g') }}</td>
              <td class="px-4 py-3 text-center">
                <span class="text-xs" :class="microCount(food) ? 'text-emerald-400' : 'text-slate-600'">
                  {{ microCount(food) ? `${microCount(food)}/12` : NO_VALUE }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <button
                  @click.stop="removeFood(food)"
                  class="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400 transition text-sm"
                  title="Eliminar"
                >
                  🗑
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="totalPages > 1" class="px-6 py-3 border-t border-slate-800 flex items-center justify-between">
        <span class="text-xs text-slate-500">Página {{ page + 1 }} de {{ totalPages }}</span>
        <div class="flex gap-2">
          <button
            @click="page = Math.max(0, page - 1)"
            :disabled="page === 0"
            class="px-3 py-1 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-400 disabled:opacity-30 hover:bg-slate-700 transition"
          >←</button>
          <button
            @click="page = Math.min(totalPages - 1, page + 1)"
            :disabled="page >= totalPages - 1"
            class="px-3 py-1 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-400 disabled:opacity-30 hover:bg-slate-700 transition"
          >→</button>
        </div>
      </div>
    </div>

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
    alert(err?.data?.statusMessage || 'Error al eliminar el alimento.')
  }
}
</script>
