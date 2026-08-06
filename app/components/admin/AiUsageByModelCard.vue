<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden mb-6">
    <div class="px-6 py-4 border-b border-slate-800 flex items-center gap-3">
      <h2 class="text-lg font-semibold text-slate-100">Uso por modelo</h2>
      <span class="text-xs bg-violet-950/60 text-violet-400 px-2 py-0.5 rounded font-medium">Solo admin</span>
    </div>

    <div v-if="pending" class="p-6 text-center text-slate-500 text-sm">Cargando...</div>
    <div v-else-if="!rows.length" class="p-6 text-center text-slate-600 text-sm">Sin uso de IA en este periodo.</div>
    <table v-else class="w-full text-sm">
      <thead class="bg-slate-800 text-slate-500 uppercase text-xs">
        <tr>
          <th class="px-4 py-3 text-left">Modelo</th>
          <th class="px-4 py-3 text-center">Interacciones</th>
          <th class="px-4 py-3 text-right">Tokens entrada</th>
          <th class="px-4 py-3 text-right">Tokens salida</th>
          <th class="px-4 py-3 text-right">Coste</th>
          <th class="px-4 py-3 text-left">Último uso</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-800">
        <tr v-for="r in rows" :key="r.model" class="hover:bg-slate-800/50 transition">
          <td class="px-4 py-3">
            <span class="font-mono text-sm font-semibold text-violet-300">{{ r.model }}</span>
            <span v-if="!r.priced" class="ml-2 text-xs bg-amber-950/60 text-amber-400 px-1.5 py-0.5 rounded">sin precio</span>
          </td>
          <td class="px-4 py-3 text-center text-slate-400">{{ formatTokens(r.interactions) }}</td>
          <td class="px-4 py-3 text-right text-sky-300">{{ formatTokens(r.inputTokens) }}</td>
          <td class="px-4 py-3 text-right text-emerald-300">{{ formatTokens(r.outputTokens) }}</td>
          <td class="px-4 py-3 text-right font-medium"
            :class="r.priced ? 'text-slate-200' : 'text-slate-600'">
            {{ r.priced ? formatCost(r.cost, r.currency) : NO_VALUE }}
          </td>
          <td class="px-4 py-3 text-slate-500 text-xs">{{ formatDateTime(r.last_used_at) }}</td>
        </tr>
      </tbody>
      <tfoot class="bg-slate-800/50 font-semibold">
        <tr>
          <td class="px-4 py-3 text-slate-300">Total</td>
          <td class="px-4 py-3 text-center text-slate-300">{{ formatTokens(sum('interactions')) }}</td>
          <td class="px-4 py-3 text-right text-sky-300">{{ formatTokens(sum('inputTokens')) }}</td>
          <td class="px-4 py-3 text-right text-emerald-300">{{ formatTokens(sum('outputTokens')) }}</td>
          <td class="px-4 py-3 text-right text-slate-100">{{ formatCost(sum('cost')) }}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>

<script setup lang="ts">
interface ModelRow {
  model: string
  currency: string
  priced: boolean
  interactions: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  last_used_at: string | null
}

const props = defineProps<{ rows: ModelRow[]; pending?: boolean }>()

const sum = (key: 'interactions' | 'inputTokens' | 'outputTokens' | 'cost') =>
  props.rows.reduce((acc, r) => acc + (r[key] ?? 0), 0)
</script>
