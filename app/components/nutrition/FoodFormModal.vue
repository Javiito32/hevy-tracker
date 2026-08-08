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
              <h3 class="font-semibold text-ink">{{ food ? 'Editar alimento' : 'Nuevo alimento' }}</h3>
              <p class="text-xs text-ink-3 mt-0.5">Todos los valores, por 100 g de producto</p>
            </div>
            <button @click="$emit('close')" class="text-ink-3 hover:text-ink-2 text-2xl leading-none transition">×</button>
          </div>

          <div class="overflow-y-auto flex-grow p-6 space-y-6">
            <div v-if="error" class="bg-danger/10 border border-danger/40 text-danger px-4 py-3 rounded-lg text-sm">
              {{ error }}
            </div>

            <div>
              <p class="text-xs font-medium text-ink-3 uppercase tracking-wider mb-3">Identificación</p>
              <div class="space-y-3">
                <div>
                  <label class="block text-sm font-medium text-ink-2 mb-1.5">Nombre *</label>
                  <input v-model="form.name" type="text" required :class="INPUT" placeholder="Ej: Avena en copos" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <label class="block text-xs text-ink-3 mb-1">Marca</label>
                    <input v-model="form.brand" type="text" :class="INPUT" placeholder="Opcional" />
                  </div>
                  <div>
                    <label class="block text-xs text-ink-3 mb-1">Código de barras</label>
                    <input v-model="form.barcode" type="text" :class="INPUT" placeholder="Opcional" />
                  </div>
                  <div>
                    <label class="block text-xs text-ink-3 mb-1">Ración (g)</label>
                    <input v-model="form.serving_size_g" type="number" step="0.1" min="0" :class="INPUT" placeholder="Ej: 60" />
                  </div>
                  <div>
                    <label class="block text-xs text-ink-3 mb-1">Etiqueta de ración</label>
                    <input v-model="form.serving_label" type="text" :class="INPUT" placeholder="Ej: 1 unidad" />
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p class="text-xs font-medium text-ink-3 uppercase tracking-wider mb-3">Energía y macros (por 100 g) *</p>
              <div class="grid grid-cols-2 gap-3">
                <div v-for="key in MACRO_KEYS" :key="key">
                  <label class="block text-xs text-ink-3 mb-1">{{ NUTRIENT_LABELS[key] }}</label>
                  <div class="flex items-center bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-focus transition">
                    <input
                      v-model="form[key]"
                      type="number"
                      step="0.1"
                      min="0"
                      class="flex-1 bg-transparent px-3 py-2 text-ink text-sm focus:outline-none min-w-0"
                      :placeholder="key === 'kcal' ? 'Obligatorio' : '0'"
                    />
                    <span class="px-2.5 text-xs text-ink-3 flex-shrink-0">{{ NUTRIENT_UNITS[key] }}</span>
                  </div>
                </div>
              </div>
              <p v-if="macroCheck" class="text-xs text-warn mt-2">
                ⚠️ Los macros suman {{ macroCheck }} kcal. Revisa si es intencionado.
              </p>
            </div>

            <div>
              <button
                type="button"
                @click="showMicros = !showMicros"
                class="w-full flex items-center justify-between text-xs font-medium text-ink-3 uppercase tracking-wider mb-3 hover:text-ink-2 transition"
              >
                <span>Micronutrientes (por 100 g) · opcional</span>
                <span>{{ showMicros ? '▲' : '▼' }}</span>
              </button>
              <div v-if="showMicros" class="grid grid-cols-2 gap-3">
                <div v-for="key in MICRO_KEYS" :key="key">
                  <label class="block text-xs text-ink-3 mb-1">{{ NUTRIENT_LABELS[key] }}</label>
                  <div class="flex items-center bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-focus transition">
                    <input
                      v-model="form[key]"
                      type="number"
                      step="0.01"
                      min="0"
                      class="flex-1 bg-transparent px-3 py-2 text-ink text-sm focus:outline-none min-w-0"
                      placeholder="—"
                    />
                    <span class="px-2.5 text-xs text-ink-3 flex-shrink-0">{{ NUTRIENT_UNITS[key] }}</span>
                  </div>
                </div>
                <p class="col-span-2 text-xs text-ink-3">
                  Déjalo vacío si no conoces el dato. Un campo vacío se trata como
                  «desconocido» y nunca como 0, para que los totales no queden falseados.
                </p>
              </div>
            </div>
          </div>

          <div class="px-6 py-4 border-t border-line flex gap-3 justify-end flex-shrink-0">
            <button @click="$emit('close')" class="px-4 py-2 text-sm text-ink-2 hover:text-ink transition">Cancelar</button>
            <button
              @click="save"
              :disabled="saving"
              class="px-5 py-2 bg-accent text-accent-ink hover:opacity-85 text-sm font-semibold rounded-lg transition disabled:opacity-60"
            >
              {{ saving ? 'Guardando...' : 'Guardar' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </ClientOnly>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'

const props = defineProps<{ open: boolean; food?: any | null; prefill?: any | null }>()
const emit = defineEmits<{ close: []; saved: [food: any] }>()

const INPUT =
  'w-full bg-surface-2 border border-line-strong rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition'

const TEXT_FIELDS = ['name', 'brand', 'barcode', 'serving_size_g', 'serving_label'] as const

const blank = () =>
  Object.fromEntries([...TEXT_FIELDS, ...NUTRIENT_KEYS].map(k => [k, ''])) as Record<string, any>

const form = reactive<Record<string, any>>(blank())
const showMicros = ref(false)
const saving = ref(false)
const error = ref('')

const load = (source: any | null | undefined) => {
  Object.assign(form, blank())
  if (!source) return
  for (const key of [...TEXT_FIELDS, ...NUTRIENT_KEYS]) {
    if (source[key] !== null && source[key] !== undefined) form[key] = source[key]
  }
  // Open the micro section straight away when the food already carries data
  // there, so an edit never hides values the user is about to change.
  showMicros.value = MICRO_KEYS.some(k => source[k] !== null && source[k] !== undefined)
}

watch(
  () => [props.open, props.food, props.prefill],
  () => {
    if (props.open) {
      error.value = ''
      load(props.food ?? props.prefill)
    }
  },
  { immediate: true }
)

/** Warns when stated kcal and 4/4/9 disagree by more than 15%. */
const macroCheck = computed(() => {
  const kcal = Number(form.kcal)
  const fromMacros = Number(form.protein_g || 0) * 4 + Number(form.carbs_g || 0) * 4 + Number(form.fat_g || 0) * 9
  if (!kcal || !fromMacros) return null
  return Math.abs(kcal - fromMacros) / kcal > 0.15 ? Math.round(fromMacros) : null
})

const save = async () => {
  saving.value = true
  error.value = ''
  try {
    const body: Record<string, any> = {}
    for (const key of [...TEXT_FIELDS, ...NUTRIENT_KEYS]) {
      body[key] = form[key] === '' ? null : form[key]
    }
    const saved = props.food
      ? await $fetch(`/api/nutrition/foods/${props.food.id}`, { method: 'PATCH', body })
      : await $fetch('/api/nutrition/foods', { method: 'POST', body })
    emit('saved', saved)
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.data?.message || 'Error al guardar el alimento.'
  } finally {
    saving.value = false
  }
}
</script>
