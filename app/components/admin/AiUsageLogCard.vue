<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden mb-6">
    <div class="px-5 py-3.5 border-b border-line flex flex-wrap items-center gap-3">
      <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Detalle de interacciones</h2>
      <span v-if="data" class="text-xs bg-surface-2 text-ink-2 px-2 py-0.5 rounded font-medium">
        {{ formatTokens(data.total) }} registros
      </span>

      <div class="flex items-center gap-2 ml-auto">
        <select v-model="userId" class="bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-ink">
          <option value="">Todos los usuarios</option>
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
        </select>
        <select v-model="model" class="bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-1.5 text-sm text-ink font-mono focus:outline-none focus:border-ink">
          <option value="">Todos los modelos</option>
          <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>
    </div>

    <div v-if="pending" class="py-10 flex justify-center text-ink-3"><UiSpinner /></div>
    <UiEmptyState v-else-if="!items.length" title="Sin interacciones para estos filtros" />
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-2 text-ink-3 uppercase text-[11px] tracking-wide">
          <tr>
            <th class="px-4 py-2.5 text-left font-semibold">Fecha y hora</th>
            <th class="px-4 py-2.5 text-left font-semibold">Usuario</th>
            <th class="px-4 py-2.5 text-left font-semibold">Modelo</th>
            <th class="px-4 py-2.5 text-left font-semibold">Tarea</th>
            <th class="px-4 py-2.5 text-right font-semibold">Entrada</th>
            <th class="px-4 py-2.5 text-right font-semibold" title="Parte de la entrada servida desde la caché del proveedor, facturada más barata">Caché</th>
            <th class="px-4 py-2.5 text-right font-semibold">Salida</th>
            <th class="px-4 py-2.5 text-right font-semibold" title="Parte de la salida gastada razonando">Razona.</th>
            <th class="px-4 py-2.5 text-right font-semibold" title="Rondas de herramientas · tiempo de la llamada">Herr./ms</th>
            <th class="px-4 py-2.5 text-right font-semibold">Coste</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="i in items" :key="i.id" class="hover:bg-surface-2 transition">
            <td class="px-4 py-2.5 text-ink-2 text-xs whitespace-nowrap">{{ formatDateTime(i.created_at) }}</td>
            <td class="px-4 py-2.5 text-ink-2">{{ i.user_name }}</td>
            <td class="px-4 py-2.5 font-mono text-xs text-ink-2">{{ i.model }}</td>
            <td class="px-4 py-3">
              <span class="text-xs bg-surface-2 text-ink-2 px-2 py-0.5 rounded">{{ i.task_label }}</span>
            </td>
            <td class="px-4 py-2.5 text-right text-ink-2">{{ formatTokens(i.input_tokens) }}</td>
            <!-- null = el proveedor no informó de caché; 0 = informó y no hubo acierto.
                 Se distinguen: uno es desconocimiento y el otro un fallo de caché. -->
            <td class="px-4 py-2.5 text-right text-ink-3">{{ i.cached_input_tokens === null ? NO_VALUE : formatTokens(i.cached_input_tokens) }}</td>
            <td class="px-4 py-2.5 text-right text-positive">{{ formatTokens(i.output_tokens) }}</td>
            <td class="px-4 py-2.5 text-right text-ink-3">{{ i.reasoning_tokens === null ? NO_VALUE : formatTokens(i.reasoning_tokens) }}</td>
            <td class="px-4 py-2.5 text-right text-ink-3 text-xs whitespace-nowrap">
              {{ i.tool_rounds ?? NO_VALUE }} · {{ i.latency_ms == null ? NO_VALUE : formatTokens(i.latency_ms) }}
            </td>
            <td class="px-4 py-2.5 text-right font-medium"
              :class="i.cost === null ? 'text-ink-3' : 'text-ink'">
              {{ formatCost(i.cost, i.currency) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data && data.total_pages > 1" class="px-6 py-4 border-t border-line flex items-center justify-between">
      <button @click="page--" :disabled="page <= 1"
        class="text-sm text-ink-3 hover:text-ink disabled:text-ink-3 disabled:cursor-not-allowed transition">
        ← Anterior
      </button>
      <span class="text-xs text-ink-3">Página {{ page }} de {{ data.total_pages }}</span>
      <button @click="page++" :disabled="page >= data.total_pages"
        class="text-sm text-ink-3 hover:text-ink disabled:text-ink-3 disabled:cursor-not-allowed transition">
        Siguiente →
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Paginated audit log of every AI call. Fetches its own page (server-side
 * pagination) rather than slicing the aggregate response — the table is unbounded.
 */
interface LogItem {
  id: string
  created_at: string
  user_id: string
  user_name: string
  model: string | null
  task_label: string
  input_tokens: number | null
  /** Subconjunto de la entrada; null cuando el proveedor no lo informa. */
  cached_input_tokens: number | null
  /** Subconjunto de la salida. */
  reasoning_tokens: number | null
  latency_ms: number | null
  tool_rounds: number | null
  tool_calls: number | null
  output_tokens: number | null
  total_tokens: number
  cost: number | null
  currency: string
}

const props = defineProps<{
  from: string | null
  to: string | null
  users: { id: string; name: string }[]
  models: string[]
}>()

const page = ref(1)
const userId = ref('')
const model = ref('')

// Changing the range or a filter invalidates the current page number: page 7 of
// the old result set is meaningless in the new one.
watch([() => props.from, () => props.to, userId, model], () => { page.value = 1 })

const query = computed(() => ({
  from: props.from ?? undefined,
  to: props.to ?? undefined,
  userId: userId.value || undefined,
  model: model.value || undefined,
  page: page.value
}))

const { data, pending } = useFetch<{
  items: LogItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}>('/api/admin/ai-usage', { query })

const items = computed(() => data.value?.items ?? [])
</script>
