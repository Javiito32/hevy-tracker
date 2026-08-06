<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden mb-6">
    <div class="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center gap-3">
      <h2 class="text-lg font-semibold text-slate-100">Detalle de interacciones</h2>
      <span v-if="data" class="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-medium">
        {{ formatTokens(data.total) }} registros
      </span>

      <div class="flex items-center gap-2 ml-auto">
        <select v-model="userId" class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500">
          <option value="">Todos los usuarios</option>
          <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
        </select>
        <select v-model="model" class="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200 font-mono focus:outline-none focus:border-indigo-500">
          <option value="">Todos los modelos</option>
          <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>
    </div>

    <div v-if="pending" class="p-6 text-center text-slate-500 text-sm">Cargando...</div>
    <div v-else-if="!items.length" class="p-6 text-center text-slate-600 text-sm">Sin interacciones para estos filtros.</div>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-800 text-slate-500 uppercase text-xs">
          <tr>
            <th class="px-4 py-3 text-left">Fecha y hora</th>
            <th class="px-4 py-3 text-left">Usuario</th>
            <th class="px-4 py-3 text-left">Modelo</th>
            <th class="px-4 py-3 text-left">Tarea</th>
            <th class="px-4 py-3 text-right">Entrada</th>
            <th class="px-4 py-3 text-right">Salida</th>
            <th class="px-4 py-3 text-right">Coste</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800">
          <tr v-for="i in items" :key="i.id" class="hover:bg-slate-800/50 transition">
            <td class="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{{ formatDateTime(i.created_at) }}</td>
            <td class="px-4 py-3 text-slate-300">{{ i.user_name }}</td>
            <td class="px-4 py-3 font-mono text-xs text-violet-300">{{ i.model }}</td>
            <td class="px-4 py-3">
              <span class="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded">{{ i.task_label }}</span>
            </td>
            <td class="px-4 py-3 text-right text-sky-300">{{ formatTokens(i.input_tokens) }}</td>
            <td class="px-4 py-3 text-right text-emerald-300">{{ formatTokens(i.output_tokens) }}</td>
            <td class="px-4 py-3 text-right font-medium"
              :class="i.cost === null ? 'text-slate-600' : 'text-slate-200'">
              {{ formatCost(i.cost, i.currency) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="data && data.total_pages > 1" class="px-6 py-4 border-t border-slate-800 flex items-center justify-between">
      <button @click="page--" :disabled="page <= 1"
        class="text-sm text-indigo-400 hover:text-indigo-300 disabled:text-slate-700 disabled:cursor-not-allowed transition">
        ← Anterior
      </button>
      <span class="text-xs text-slate-500">Página {{ page }} de {{ data.total_pages }}</span>
      <button @click="page++" :disabled="page >= data.total_pages"
        class="text-sm text-indigo-400 hover:text-indigo-300 disabled:text-slate-700 disabled:cursor-not-allowed transition">
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
