<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden mb-6">
    <div class="px-5 py-3.5 border-b border-line flex items-center gap-3">
      <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Uso por modelo</h2>
      <span class="text-xs bg-surface-2 text-ink-2 px-2 py-0.5 rounded font-medium">Solo admin</span>
    </div>

    <div v-if="pending" class="py-10 flex justify-center text-ink-3"><UiSpinner /></div>
    <UiEmptyState v-else-if="!rows.length" title="Sin uso de IA en este periodo." />
    <table v-else class="w-full text-sm">
      <thead class="bg-surface-2 text-ink-3 uppercase text-[11px] tracking-wide">
        <tr>
          <th class="px-4 py-2.5 text-left font-semibold">Modelo</th>
          <th class="px-4 py-2.5 text-center font-semibold">Interacciones</th>
          <th class="px-4 py-2.5 text-right font-semibold">Tokens entrada</th>
          <th class="px-4 py-2.5 text-right font-semibold">Tokens salida</th>
          <th class="px-4 py-2.5 text-right font-semibold">Coste</th>
          <th class="px-4 py-2.5 text-left font-semibold">Último uso</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        <tr v-for="r in rows" :key="r.model" class="hover:bg-surface-2 transition">
          <td class="px-4 py-3">
            <span class="font-mono text-sm font-semibold text-ink-2">{{ r.model }}</span>
            <span v-if="!r.priced" class="ml-2 text-xs bg-warn/10 text-warn px-1.5 py-0.5 rounded">sin precio</span>
          </td>
          <td class="px-4 py-2.5 text-center text-ink-2">{{ formatTokens(r.interactions) }}</td>
          <td class="px-4 py-2.5 text-right text-ink-2">{{ formatTokens(r.inputTokens) }}</td>
          <td class="px-4 py-2.5 text-right text-positive">{{ formatTokens(r.outputTokens) }}</td>
          <td class="px-4 py-2.5 text-right font-medium"
            :class="r.priced ? 'text-ink' : 'text-ink-3'">
            {{ r.priced ? formatCost(r.cost, r.currency) : NO_VALUE }}
          </td>
          <td class="px-4 py-2.5 text-ink-3 text-xs">{{ formatDateTime(r.last_used_at) }}</td>
        </tr>
      </tbody>
      <tfoot class="bg-surface-2/50 font-semibold">
        <tr>
          <td class="px-4 py-2.5 text-ink-2">Total</td>
          <td class="px-4 py-2.5 text-center text-ink-2">{{ formatTokens(sum('interactions')) }}</td>
          <td class="px-4 py-2.5 text-right text-ink-2">{{ formatTokens(sum('inputTokens')) }}</td>
          <td class="px-4 py-2.5 text-right text-positive">{{ formatTokens(sum('outputTokens')) }}</td>
          <td class="px-4 py-2.5 text-right text-ink">{{ formatCost(sum('cost')) }}</td>
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
