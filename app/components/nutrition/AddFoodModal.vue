<template>
  <ClientOnly>
    <Teleport to="body">
      <div
        v-if="open"
        class="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        @click.self="$emit('close')"
      >
        <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
          <div class="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0">
            <div>
              <h3 class="font-semibold text-slate-100">Añadir alimento</h3>
              <p class="text-xs text-slate-500 mt-0.5">{{ meal?.name }}</p>
            </div>
            <button @click="$emit('close')" class="text-slate-500 hover:text-slate-300 text-2xl leading-none transition">×</button>
          </div>

          <div class="overflow-y-auto flex-grow p-6 space-y-4">
            <div v-if="error" class="bg-rose-950/60 border border-rose-800 text-rose-400 px-4 py-3 rounded-lg text-sm">
              {{ error }}
            </div>

            <template v-if="!selected">
              <input
                v-model="query"
                type="search"
                placeholder="Buscar en tu catálogo..."
                class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              />

              <div v-if="pending" class="flex justify-center py-8">
                <div class="animate-spin w-6 h-6 rounded-full border-4 border-indigo-500 border-t-transparent"></div>
              </div>

              <div v-else-if="matches.length" class="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                <button
                  v-for="food in matches"
                  :key="food.id"
                  type="button"
                  @click="select(food)"
                  class="w-full text-left px-4 py-2.5 hover:bg-slate-800/50 transition flex items-center justify-between gap-3"
                >
                  <div class="min-w-0">
                    <div class="text-sm text-slate-200 truncate">{{ food.name }}</div>
                    <div class="text-xs text-slate-500 truncate">
                      <span v-if="food.brand">{{ food.brand }} · </span>por 100 g
                    </div>
                  </div>
                  <span class="text-xs text-slate-400 flex-shrink-0">{{ formatNutrientValue(food.kcal, 'kcal') }} kcal</span>
                </button>
              </div>

              <p v-else class="text-sm text-slate-500 text-center py-6">
                {{ query ? 'Ningún alimento coincide.' : 'Tu catálogo está vacío.' }}
              </p>

              <div class="border-t border-slate-800 pt-4">
                <NuxtLink to="/nutrition/foods" class="text-sm text-indigo-400 hover:text-indigo-300 transition">
                  Gestionar catálogo y buscar en Open Food Facts →
                </NuxtLink>
              </div>
            </template>

            <template v-else>
              <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-3">
                <div>
                  <div class="text-slate-100 font-medium">{{ selected.name }}</div>
                  <div class="text-xs text-slate-500">
                    <span v-if="selected.brand">{{ selected.brand }} · </span>
                    {{ formatNutrientValue(selected.kcal, 'kcal') }} kcal / 100 g
                  </div>
                </div>

                <div>
                  <label class="block text-sm font-medium text-slate-400 mb-1.5">Cantidad</label>
                  <div class="flex items-center bg-slate-800 border border-slate-700 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 transition">
                    <input
                      v-model="quantity"
                      type="number"
                      min="0"
                      step="1"
                      class="flex-1 bg-transparent px-3 py-2 text-slate-100 text-sm focus:outline-none min-w-0"
                    />
                    <span class="px-2.5 text-xs text-slate-600 flex-shrink-0">g</span>
                  </div>
                  <div v-if="selected.serving_size_g" class="flex gap-2 mt-2">
                    <button
                      v-for="units in [1, 2, 3]"
                      :key="units"
                      type="button"
                      @click="quantity = String(selected.serving_size_g * units)"
                      class="px-2.5 py-1 text-xs rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:bg-slate-700 transition"
                    >
                      {{ units }} × {{ selected.serving_label || 'ración' }}
                      <span class="text-slate-600">({{ formatGrams(selected.serving_size_g * units) }})</span>
                    </button>
                  </div>
                </div>

                <div class="grid grid-cols-4 gap-2 text-center">
                  <div v-for="key in MACRO_KEYS" :key="key" class="bg-slate-900 rounded-lg py-2">
                    <div class="text-sm text-slate-200">{{ formatNutrientValue(scaled[key], key) }}</div>
                    <div class="text-[10px] text-slate-500 uppercase tracking-wider">{{ NUTRIENT_SHORT_LABELS[key] }}</div>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <div v-if="selected" class="px-6 py-4 border-t border-slate-800 flex gap-3 justify-end flex-shrink-0">
            <button @click="selected = null" class="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition">
              Cambiar alimento
            </button>
            <button
              @click="add"
              :disabled="saving || !(Number(quantity) > 0)"
              class="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-60"
            >
              {{ saving ? 'Añadiendo...' : 'Añadir' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </ClientOnly>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{ open: boolean; meal?: any | null }>()
const emit = defineEmits<{ close: []; added: [] }>()

const { data: foods, pending, refresh } = useFetch<any[]>('/api/nutrition/foods')

const query = ref('')
const selected = ref<any | null>(null)
const quantity = ref('100')
const saving = ref(false)
const error = ref('')

const matches = computed(() => {
  const list = foods.value ?? []
  const q = query.value.trim().toLowerCase()
  const filtered = q
    ? list.filter(f => [f.name, f.brand].some((v: string | null) => v?.toLowerCase().includes(q)))
    : list
  return filtered.slice(0, 50)
})

/** Live preview of what this quantity contributes, from the catalogue values. */
const scaled = computed(() => {
  const grams = Number(quantity.value) || 0
  const food = selected.value
  const out: Record<string, number | null> = {}
  for (const key of MACRO_KEYS) {
    const value = food?.[key]
    out[key] = typeof value === 'number' ? (value * grams) / 100 : null
  }
  return out
})

watch(
  () => props.open,
  isOpen => {
    if (!isOpen) return
    query.value = ''
    selected.value = null
    quantity.value = '100'
    error.value = ''
    refresh()
  }
)

const select = (food: any) => {
  selected.value = food
  quantity.value = String(food.serving_size_g || 100)
}

const add = async () => {
  if (!selected.value || !props.meal) return
  saving.value = true
  error.value = ''
  try {
    await $fetch('/api/nutrition/items', {
      method: 'POST',
      body: {
        diet_meal_id: props.meal.id,
        food_id: selected.value.id,
        quantity_g: Number(quantity.value)
      }
    })
    emit('added')
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Error al añadir el alimento.'
  } finally {
    saving.value = false
  }
}
</script>
