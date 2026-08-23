<template>
  <ClientOnly>
    <Teleport to="body">
      <div
        v-if="open"
        class="fixed inset-0 bg-bg/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4"
        @click.self="$emit('close')"
      >
        <div class="bg-surface border border-line-strong rounded-card w-full max-w-2xl max-h-[90vh] flex flex-col">
          <div class="flex items-center justify-between px-5 py-3.5 border-b border-line flex-shrink-0">
            <div>
              <h3 class="font-semibold text-ink">Buscar producto</h3>
              <p class="text-xs text-ink-3 mt-0.5">Open Food Facts, y Nutriinfo si el código no está ahí</p>
            </div>
            <button @click="$emit('close')" class="text-ink-3 hover:text-ink-2 text-2xl leading-none transition">×</button>
          </div>

          <div class="px-6 pt-4 flex gap-1 border-b border-line flex-shrink-0">
            <button
              v-for="t in TABS"
              :key="t.key"
              @click="tab = t.key"
              class="px-4 py-2 text-sm rounded-t-lg transition border-b-2 -mb-px"
              :class="tab === t.key
                ? 'text-ink-2 border-ink'
                : 'text-ink-3 border-transparent hover:text-ink-2'"
            >
              {{ t.label }}
            </button>
          </div>

          <div class="overflow-y-auto flex-grow p-6 space-y-4">
            <div v-if="error" class="bg-danger/10 border border-danger/40 text-danger px-4 py-3 rounded-lg text-sm">
              {{ error }}
            </div>

            <!-- Búsqueda por nombre -->
            <template v-if="tab === 'name'">
              <input
                v-model="query"
                type="search"
                placeholder="Ej: yogur griego, avena, atún..."
                :class="INPUT"
                @keydown.enter.prevent="runSearch"
              />
              <p class="text-xs text-ink-3">
                Búsqueda por nombre en Open Food Facts. Los resultados muestran
                sólo kcal y macros; los micronutrientes se descargan al añadir
                el alimento al catálogo.
              </p>

              <div v-if="searching" class="flex justify-center py-8">
                <UiSpinner class="text-ink-3" />
              </div>

              <div v-else-if="results.length" class="divide-y divide-line border border-line rounded-lg overflow-hidden">
                <button
                  v-for="hit in results"
                  :key="hit.code"
                  type="button"
                  @click="preview(hit.code)"
                  class="w-full text-left px-4 py-3 hover:bg-surface-2/50 transition flex items-center gap-3"
                >
                  <img v-if="hit.image_url" :src="hit.image_url" alt="" class="w-10 h-10 object-contain rounded bg-surface-2 flex-shrink-0" />
                  <div class="w-10 h-10 rounded bg-surface-2 flex-shrink-0 flex items-center justify-center text-ink-3 text-xs" v-else>—</div>
                  <div class="min-w-0 flex-grow">
                    <div class="text-sm text-ink truncate">{{ hit.name }}</div>
                    <div class="text-xs text-ink-3 truncate">
                      <span v-if="hit.brand">{{ hit.brand }} · </span>{{ hit.code }}
                    </div>
                  </div>
                  <div class="text-right flex-shrink-0 text-xs text-ink-2">
                    <div>{{ formatNutrientValue(hit.kcal, 'kcal') }} kcal</div>
                    <div class="text-ink-3">P {{ formatNutrientValue(hit.protein_g, 'protein_g') }} · G {{ formatNutrientValue(hit.fat_g, 'fat_g') }}</div>
                  </div>
                </button>
              </div>

              <p v-else-if="searched && query.trim().length >= 2" class="text-sm text-ink-3 text-center py-8">
                Ningún producto coincide. Prueba otro término o añade el alimento manualmente.
              </p>
            </template>

            <!-- Código de barras -->
            <template v-else>
              <div>
                <label class="block text-sm font-medium text-ink-2 mb-1.5">Código de barras</label>
                <div class="flex gap-2">
                  <input
                    v-model="barcode"
                    type="text"
                    inputmode="numeric"
                    placeholder="Ej: 3017624010701"
                    :class="INPUT"
                    @keydown.enter.prevent="preview(barcode)"
                  />
                  <button
                    type="button"
                    @click="preview(barcode)"
                    :disabled="loadingPreview || !barcode.trim()"
                    class="px-4 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 disabled:opacity-50 transition flex-shrink-0"
                  >
                    Buscar
                  </button>
                </div>
                <p class="text-xs text-ink-3 mt-1.5">
                  Si Open Food Facts no tiene el código, se consulta Nutriinfo.
                </p>
              </div>
              <NutritionBarcodeScanner @detected="onDetected" />
            </template>

            <!-- Vista previa -->
            <div v-if="loadingPreview" class="flex justify-center py-8">
              <UiSpinner class="text-ink-3" />
            </div>

            <div v-else-if="candidate" class="bg-surface-2 border border-line rounded-card p-4 space-y-3">
              <div class="flex items-start gap-3">
                <img v-if="candidate.image_url" :src="candidate.image_url" alt="" class="w-14 h-14 object-contain rounded bg-surface-2 flex-shrink-0" />
                <div class="min-w-0">
                  <div class="text-ink font-medium">{{ candidate.name }}</div>
                  <div class="text-xs text-ink-3">
                    <span v-if="candidate.brand">{{ candidate.brand }} · </span>{{ candidate.barcode }}
                    <span v-if="candidateSourceLabel"> · {{ candidateSourceLabel }}</span>
                    <span v-if="candidate.serving_size_g"> · {{ candidate.serving_label || 'ración' }} = {{ formatGrams(candidate.serving_size_g) }}</span>
                  </div>
                </div>
              </div>

              <div v-if="alreadyInCatalog" class="text-xs text-warn">
                Este alimento ya está en tu catálogo. Al añadirlo se actualizarán sus valores.
              </div>

              <div class="grid grid-cols-4 gap-2 text-center">
                <div v-for="key in MACRO_KEYS" :key="key" class="bg-surface rounded-lg py-2">
                  <div class="text-sm text-ink">{{ formatNutrientValue(candidate[key], key) }}</div>
                  <div class="text-[10px] text-ink-3 uppercase tracking-wide">{{ NUTRIENT_SHORT_LABELS[key] }}</div>
                </div>
              </div>

              <div class="text-xs text-ink-3">
                Micronutrientes disponibles: <span class="text-ink-2">{{ microCount }}/12</span>
                <span v-if="microCount < 12"> · el resto quedará como desconocido, no como 0.</span>
              </div>

              <div class="flex justify-end gap-3 pt-1">
                <button type="button" @click="candidate = null" class="px-4 py-2 text-sm text-ink-2 hover:text-ink transition">
                  Descartar
                </button>
                <button
                  type="button"
                  @click="importCandidate"
                  :disabled="importing"
                  class="px-5 py-2 bg-accent text-accent-ink hover:opacity-85 text-sm font-semibold rounded-lg transition disabled:opacity-60"
                >
                  {{ importing ? 'Añadiendo...' : 'Añadir al catálogo' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </ClientOnly>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; imported: [food: any] }>()

const INPUT =
  'w-full bg-surface-2 border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition'

const TABS = [
  { key: 'name', label: 'Por nombre' },
  { key: 'barcode', label: 'Código de barras' }
] as const

const tab = ref<'name' | 'barcode'>('name')
const query = ref('')
const barcode = ref('')
const results = ref<any[]>([])
const candidate = ref<any | null>(null)
const alreadyInCatalog = ref(false)
const searching = ref(false)
const searched = ref(false)
const loadingPreview = ref(false)
const importing = ref(false)
const error = ref('')

const microCount = computed(
  () => MICRO_KEYS.filter(k => candidate.value?.[k] !== null && candidate.value?.[k] !== undefined).length
)

const candidateSourceLabel = computed(() => {
  const source = candidate.value?.source
  if (source === 'nutriinfo') return 'Nutriinfo'
  if (source === 'openfoodfacts') return 'Open Food Facts'
  return ''
})

watch(
  () => props.open,
  isOpen => {
    if (!isOpen) return
    query.value = ''
    barcode.value = ''
    results.value = []
    candidate.value = null
    searched.value = false
    error.value = ''
  }
)

// OFF rate-limits search at ~10 req/min per IP, so the input is debounced
// rather than fired on every keystroke.
let debounceId: ReturnType<typeof setTimeout> | null = null
watch(query, () => {
  if (debounceId) clearTimeout(debounceId)
  if (query.value.trim().length < 2) {
    results.value = []
    searched.value = false
    return
  }
  debounceId = setTimeout(runSearch, 500)
})

const runSearch = async () => {
  const q = query.value.trim()
  if (q.length < 2) return
  searching.value = true
  error.value = ''
  candidate.value = null
  try {
    const res = await $fetch<any>('/api/nutrition/foods/search-external', { query: { q } })
    results.value = res.results ?? []
    searched.value = true
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Error al buscar en Open Food Facts.'
    results.value = []
  } finally {
    searching.value = false
  }
}

const preview = async (code: string) => {
  const clean = (code || '').trim()
  if (!clean) return
  loadingPreview.value = true
  error.value = ''
  candidate.value = null
  try {
    const res = await $fetch<any>('/api/nutrition/foods/barcode', { query: { code: clean } })
    candidate.value = res.food
    alreadyInCatalog.value = res.already_in_catalog
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'No se pudo obtener el producto.'
  } finally {
    loadingPreview.value = false
  }
}

const onDetected = (code: string) => {
  barcode.value = code
  preview(code)
}

const importCandidate = async () => {
  if (!candidate.value) return
  importing.value = true
  error.value = ''
  try {
    // Import always goes by code so the server re-fetches the full product:
    // the search payload has no micronutrients in it.
    const food = await $fetch('/api/nutrition/foods/import', {
      method: 'POST',
      body: { barcode: candidate.value.barcode }
    })
    emit('imported', food)
  } catch (err: any) {
    error.value = err?.data?.statusMessage || 'Error al añadir el alimento.'
  } finally {
    importing.value = false
  }
}
</script>
