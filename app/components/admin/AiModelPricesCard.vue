<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden mb-6">
    <div class="px-5 py-3.5 border-b border-line flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Precios de modelos</h2>
        <span class="text-xs bg-surface-2 text-ink-2 px-2 py-0.5 rounded font-medium">USD por 1M tokens</span>
      </div>
      <button @click="showForm = !showForm"
        class="text-sm font-medium text-ink-3 hover:text-ink transition">
        {{ showForm ? 'Cancelar' : '+ Añadir modelo' }}
      </button>
    </div>

    <!-- Models in use with no price: their cost is missing from every total. -->
    <div v-if="unpricedModels.length" class="px-6 py-3 bg-warn/10 border-b border-warn/40">
      <p class="text-sm text-warn font-medium mb-1">Modelos usados sin precio configurado</p>
      <div class="flex flex-wrap gap-2 mt-2">
        <button v-for="m in unpricedModels" :key="m.model" @click="prefill(m.model)"
          class="font-mono text-xs bg-warn/10 text-warn hover:bg-warn/10 px-2 py-1 rounded transition">
          {{ m.model }} · {{ m.interactions }} usos
        </button>
      </div>
      <p class="text-xs text-warn/70 mt-2">Su coste no se incluye en los totales. Pulsa uno para configurarlo.</p>
    </div>

    <!-- Add / edit-by-slug form. Same endpoint upserts, so re-adding an existing
         model updates its price. -->
    <form v-if="showForm" @submit.prevent="save" class="px-5 py-3.5 border-b border-line bg-bg/40">
      <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div class="md:col-span-2">
          <label class="block text-xs text-ink-3 mb-1">Modelo (slug)</label>
          <input v-model="form.model" required placeholder="anthropic/claude-sonnet-5"
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink font-mono focus:outline-none focus:border-ink" />
        </div>
        <div>
          <label class="block text-xs text-ink-3 mb-1">Entrada / 1M</label>
          <input v-model="form.input_per_1m" type="number" step="0.01" min="0" required placeholder="3.00"
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
        </div>
        <div>
          <label class="block text-xs text-ink-3 mb-1">Salida / 1M</label>
          <input v-model="form.output_per_1m" type="number" step="0.01" min="0" required placeholder="15.00"
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
        </div>
        <div>
          <!-- Optional: left empty, the cached tokens are costed at the full
               input rate rather than at an invented discount. -->
          <label class="block text-xs text-ink-3 mb-1">Caché lectura / 1M</label>
          <input v-model="form.cached_input_per_1m" type="number" step="0.01" min="0" placeholder="opcional"
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
        </div>
        <div>
          <!-- Optional too, but it errs the other way: a vendor that charges a
               premium for cache writes (Anthropic, 1.25x) is UNDER-billed while
               this is empty. Left blank rather than hardcoding the multiplier —
               it is the vendor's to change. -->
          <label class="block text-xs text-ink-3 mb-1">Caché escritura / 1M</label>
          <input v-model="form.cache_write_per_1m" type="number" step="0.01" min="0" placeholder="opcional"
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-ink" />
        </div>
      </div>
      <div class="flex items-center gap-3 mt-3">
        <button type="submit" :disabled="saving"
          class="bg-accent text-accent-ink hover:opacity-85 disabled:opacity-50 px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium transition">
          {{ saving ? 'Guardando...' : 'Guardar precio' }}
        </button>
        <p v-if="formError" class="text-sm text-danger">{{ formError }}</p>
      </div>
    </form>

    <div v-if="pending" class="py-10 flex justify-center text-ink-3"><UiSpinner /></div>
    <UiEmptyState
      v-else-if="!prices.length"
      title="Sin precios configurados"
      description="Los costes se mostrarán como «—» hasta que añadas el primero."
    />
    <table v-else class="w-full text-sm">
      <thead class="bg-surface-2 text-ink-3 uppercase text-[11px] tracking-wide">
        <tr>
          <th class="px-4 py-2.5 text-left font-semibold">Modelo</th>
          <th class="px-4 py-2.5 text-right font-semibold">Entrada / 1M</th>
          <th class="px-4 py-2.5 text-right font-semibold">Salida / 1M</th>
          <th class="px-4 py-2.5 text-right font-semibold">Caché lec. / 1M</th>
          <th class="px-4 py-2.5 text-right font-semibold">Caché esc. / 1M</th>
          <th class="px-4 py-2.5 text-center font-semibold">Moneda</th>
          <th class="px-4 py-2.5 text-right font-semibold"></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        <tr v-for="p in prices" :key="p.id" class="hover:bg-surface-2 transition">
          <td class="px-4 py-2.5 font-mono text-ink-2">{{ p.model }}</td>
          <td class="px-4 py-2.5 text-right">
            <input v-model="edits[p.id]!.input_per_1m" type="number" step="0.01" min="0"
              class="w-24 bg-surface-2 border border-line-strong hover:border-ink-3 rounded px-2 py-1 text-right text-ink focus:outline-none focus:border-ink" />
          </td>
          <td class="px-4 py-2.5 text-right">
            <input v-model="edits[p.id]!.output_per_1m" type="number" step="0.01" min="0"
              class="w-24 bg-surface-2 border border-line-strong hover:border-ink-3 rounded px-2 py-1 text-right text-ink focus:outline-none focus:border-ink" />
          </td>
          <td class="px-4 py-2.5 text-right">
            <input v-model="edits[p.id]!.cached_input_per_1m" type="number" step="0.01" min="0" placeholder="—"
              class="w-24 bg-surface-2 border border-line-strong hover:border-ink-3 rounded px-2 py-1 text-right text-ink focus:outline-none focus:border-ink" />
          </td>
          <td class="px-4 py-2.5 text-right">
            <input v-model="edits[p.id]!.cache_write_per_1m" type="number" step="0.01" min="0" placeholder="—"
              class="w-24 bg-surface-2 border border-line-strong hover:border-ink-3 rounded px-2 py-1 text-right text-ink focus:outline-none focus:border-ink" />
          </td>
          <td class="px-4 py-2.5 text-center text-ink-3">{{ p.currency }}</td>
          <td class="px-4 py-2.5 text-right whitespace-nowrap">
            <button v-if="isDirty(p)" @click="update(p)" :disabled="saving"
              class="text-positive text-xs font-medium mr-3 transition">Guardar</button>
            <button @click="remove(p)" class="text-ink-3 hover:text-danger text-xs transition">Eliminar</button>
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
  /** null = not configured; cached input is then billed at the input rate. */
  cached_input_per_1m: number | null
  /** null = not configured; cache writes are then billed at the input rate. */
  cache_write_per_1m: number | null
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
const form = ref({ model: '', input_per_1m: '', output_per_1m: '', cached_input_per_1m: '', cache_write_per_1m: '' })

/** Local copy per row so an in-place edit only saves when actually changed. */
const edits = ref<Record<string, {
  input_per_1m: number | string
  output_per_1m: number | string
  cached_input_per_1m: number | string
  cache_write_per_1m: number | string
}>>({})

watch(prices, (list) => {
  edits.value = Object.fromEntries(
    list.map(p => [p.id, {
      input_per_1m: p.input_per_1m,
      output_per_1m: p.output_per_1m,
      cached_input_per_1m: p.cached_input_per_1m ?? '',
      cache_write_per_1m: p.cache_write_per_1m ?? ''
    }])
  )
}, { immediate: true })

const isDirty = (p: Price) => {
  const e = edits.value[p.id]
  if (!e) return false
  return Number(e.input_per_1m) !== p.input_per_1m
    || Number(e.output_per_1m) !== p.output_per_1m
    || cachedOf(e) !== p.cached_input_per_1m
    || writeOf(e) !== p.cache_write_per_1m
}

/** '' means "no rate configured", which is a null in the DB and not a 0. */
const optionalRate = (value: number | string | null | undefined): number | null =>
  value === '' || value == null ? null : Number(value)

const cachedOf = (e: { cached_input_per_1m: number | string }): number | null =>
  optionalRate(e.cached_input_per_1m)

const writeOf = (e: { cache_write_per_1m: number | string }): number | null =>
  optionalRate(e.cache_write_per_1m)

const prefill = (model: string) => {
  form.value = { model, input_per_1m: '', output_per_1m: '', cached_input_per_1m: '', cache_write_per_1m: '' }
  showForm.value = true
}

/** Both create and in-place edit go through the upsert endpoint. */
const post = async (body: {
  model: string
  input_per_1m: number
  output_per_1m: number
  cached_input_per_1m: number | null
  cache_write_per_1m: number | null
}) => {
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
      output_per_1m: Number(form.value.output_per_1m),
      cached_input_per_1m: cachedOf(form.value),
      cache_write_per_1m: writeOf(form.value)
    })
    form.value = { model: '', input_per_1m: '', output_per_1m: '', cached_input_per_1m: '', cache_write_per_1m: '' }
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
    await post({
      model: p.model,
      input_per_1m: Number(e.input_per_1m),
      output_per_1m: Number(e.output_per_1m),
      cached_input_per_1m: cachedOf(e),
      cache_write_per_1m: writeOf(e)
    })
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
