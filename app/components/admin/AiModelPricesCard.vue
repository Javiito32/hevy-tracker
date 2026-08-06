<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden mb-6">
    <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <h2 class="text-lg font-semibold text-slate-100">Precios de modelos</h2>
        <span class="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-medium">USD por 1M tokens</span>
      </div>
      <button @click="showForm = !showForm"
        class="text-sm font-medium text-indigo-400 hover:text-indigo-300 transition">
        {{ showForm ? 'Cancelar' : '+ Añadir modelo' }}
      </button>
    </div>

    <!-- Models in use with no price: their cost is missing from every total. -->
    <div v-if="unpricedModels.length" class="px-6 py-3 bg-amber-950/30 border-b border-amber-900/40">
      <p class="text-sm text-amber-300 font-medium mb-1">Modelos usados sin precio configurado</p>
      <div class="flex flex-wrap gap-2 mt-2">
        <button v-for="m in unpricedModels" :key="m.model" @click="prefill(m.model)"
          class="font-mono text-xs bg-amber-950/60 text-amber-300 hover:bg-amber-900/60 px-2 py-1 rounded transition">
          {{ m.model }} · {{ m.interactions }} usos
        </button>
      </div>
      <p class="text-xs text-amber-500/70 mt-2">Su coste no se incluye en los totales. Pulsa uno para configurarlo.</p>
    </div>

    <!-- Add / edit-by-slug form. Same endpoint upserts, so re-adding an existing
         model updates its price. -->
    <form v-if="showForm" @submit.prevent="save" class="px-6 py-4 border-b border-slate-800 bg-slate-950/40">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div class="md:col-span-2">
          <label class="block text-xs text-slate-500 mb-1">Modelo (slug)</label>
          <input v-model="form.model" required placeholder="anthropic/claude-sonnet-5"
            class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 font-mono focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Entrada / 1M</label>
          <input v-model="form.input_per_1m" type="number" step="0.01" min="0" required placeholder="3.00"
            class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">Salida / 1M</label>
          <input v-model="form.output_per_1m" type="number" step="0.01" min="0" required placeholder="15.00"
            class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500" />
        </div>
      </div>
      <div class="flex items-center gap-3 mt-3">
        <button type="submit" :disabled="saving"
          class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
          {{ saving ? 'Guardando...' : 'Guardar precio' }}
        </button>
        <p v-if="formError" class="text-sm text-rose-400">{{ formError }}</p>
      </div>
    </form>

    <div v-if="pending" class="p-6 text-center text-slate-500 text-sm">Cargando...</div>
    <div v-else-if="!prices.length" class="p-6 text-center text-slate-600 text-sm">
      Sin precios configurados. Los costes se mostrarán como «—» hasta que añadas uno.
    </div>
    <table v-else class="w-full text-sm">
      <thead class="bg-slate-800 text-slate-500 uppercase text-xs">
        <tr>
          <th class="px-4 py-3 text-left">Modelo</th>
          <th class="px-4 py-3 text-right">Entrada / 1M</th>
          <th class="px-4 py-3 text-right">Salida / 1M</th>
          <th class="px-4 py-3 text-center">Moneda</th>
          <th class="px-4 py-3 text-right"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-800">
        <tr v-for="p in prices" :key="p.id" class="hover:bg-slate-800/50 transition">
          <td class="px-4 py-3 font-mono text-violet-300">{{ p.model }}</td>
          <td class="px-4 py-3 text-right">
            <input v-model="edits[p.id]!.input_per_1m" type="number" step="0.01" min="0"
              class="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right text-slate-200 focus:outline-none focus:border-indigo-500" />
          </td>
          <td class="px-4 py-3 text-right">
            <input v-model="edits[p.id]!.output_per_1m" type="number" step="0.01" min="0"
              class="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-right text-slate-200 focus:outline-none focus:border-indigo-500" />
          </td>
          <td class="px-4 py-3 text-center text-slate-500">{{ p.currency }}</td>
          <td class="px-4 py-3 text-right whitespace-nowrap">
            <button v-if="isDirty(p)" @click="update(p)" :disabled="saving"
              class="text-emerald-400 hover:text-emerald-300 text-xs font-medium mr-3 transition">Guardar</button>
            <button @click="remove(p)" class="text-slate-600 hover:text-rose-400 text-xs transition">Eliminar</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
/**
 * Editable model price table. Prices live in the DB (AiModelPrice) rather than in
 * ai-config.ts so a vendor price change doesn't need a code edit and a deploy.
 */
interface Price {
  id: string
  model: string
  input_per_1m: number
  output_per_1m: number
  currency: string
}

const emit = defineEmits<{ changed: [] }>()

// Not awaited: a top-level await here would make this an async component and
// force a Suspense boundary. Nuxt resolves pending useFetch calls before SSR
// renders either way.
const { data, pending, refresh } = useFetch<{
  prices: Price[]
  unpriced_models: { model: string; interactions: number }[]
}>('/api/admin/ai-prices')

const prices = computed(() => data.value?.prices ?? [])
const unpricedModels = computed(() => data.value?.unpriced_models ?? [])

const showForm = ref(false)
const saving = ref(false)
const formError = ref('')
const form = ref({ model: '', input_per_1m: '', output_per_1m: '' })

/** Local copy per row so an in-place edit only saves when actually changed. */
const edits = ref<Record<string, { input_per_1m: number | string; output_per_1m: number | string }>>({})

watch(prices, (list) => {
  edits.value = Object.fromEntries(
    list.map(p => [p.id, { input_per_1m: p.input_per_1m, output_per_1m: p.output_per_1m }])
  )
}, { immediate: true })

const isDirty = (p: Price) => {
  const e = edits.value[p.id]
  if (!e) return false
  return Number(e.input_per_1m) !== p.input_per_1m || Number(e.output_per_1m) !== p.output_per_1m
}

const prefill = (model: string) => {
  form.value = { model, input_per_1m: '', output_per_1m: '' }
  showForm.value = true
}

/** Both create and in-place edit go through the upsert endpoint. */
const post = async (body: { model: string; input_per_1m: number; output_per_1m: number }) => {
  await $fetch('/api/admin/ai-prices', { method: 'POST', body })
  await refresh()
  // Costs across the whole panel change with the price, so the parent refetches.
  emit('changed')
}

const save = async () => {
  saving.value = true
  formError.value = ''
  try {
    await post({
      model: form.value.model.trim(),
      input_per_1m: Number(form.value.input_per_1m),
      output_per_1m: Number(form.value.output_per_1m)
    })
    form.value = { model: '', input_per_1m: '', output_per_1m: '' }
    showForm.value = false
  } catch (e: any) {
    formError.value = e?.statusMessage ?? 'No se pudo guardar el precio'
  } finally {
    saving.value = false
  }
}

const update = async (p: Price) => {
  const e = edits.value[p.id]
  if (!e) return
  saving.value = true
  try {
    await post({ model: p.model, input_per_1m: Number(e.input_per_1m), output_per_1m: Number(e.output_per_1m) })
  } finally {
    saving.value = false
  }
}

const remove = async (p: Price) => {
  if (!confirm(`¿Eliminar el precio de ${p.model}? Su coste dejará de calcularse.`)) return
  await $fetch(`/api/admin/ai-prices/${p.id}`, { method: 'DELETE' })
  await refresh()
  emit('changed')
}
</script>
