<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden mb-6">
    <div class="px-5 py-3.5 border-b border-line">
      <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Interacciones más caras</h2>
      <p class="text-xs text-ink-3 mt-1">
        Las {{ rows.length || 10 }} llamadas de mayor coste del periodo. Útil para cazar conversaciones
        que arrastran demasiado contexto.
      </p>
    </div>

    <div v-if="pending" class="py-10 flex justify-center text-ink-3"><UiSpinner /></div>
    <UiEmptyState v-else-if="!rows.length" title="
      Sin interacciones con coste calculable en este periodo.
    " />
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-2 text-ink-3 uppercase text-[11px] tracking-wide">
          <tr>
            <th class="px-4 py-2.5 text-left font-semibold">#</th>
            <th class="px-4 py-2.5 text-left font-semibold">Fecha</th>
            <th class="px-4 py-2.5 text-left font-semibold">Usuario</th>
            <th class="px-4 py-2.5 text-left font-semibold">Tarea</th>
            <th class="px-4 py-2.5 text-right font-semibold">Entrada</th>
            <th class="px-4 py-2.5 text-right font-semibold">Salida</th>
            <th class="px-4 py-2.5 text-right font-semibold">Coste</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="(r, i) in rows" :key="r.id" class="hover:bg-surface-2 transition">
            <td class="px-4 py-2.5 text-ink-3 font-data">{{ i + 1 }}</td>
            <td class="px-4 py-2.5 text-ink-2 text-xs whitespace-nowrap">{{ formatDateTime(r.created_at) }}</td>
            <td class="px-4 py-3">
              <p class="text-ink-2">{{ r.user_name }}</p>
              <p v-if="r.conversation_title" class="text-xs text-ink-3 truncate max-w-[12rem]"
                :title="r.conversation_title">{{ r.conversation_title }}</p>
            </td>
            <td class="px-4 py-3">
              <span class="text-xs bg-surface-2 text-ink-2 px-2 py-0.5 rounded">{{ r.task_label }}</span>
            </td>
            <td class="px-4 py-2.5 text-right text-ink-2 font-data">{{ formatTokens(r.input_tokens) }}</td>
            <td class="px-4 py-2.5 text-right text-positive font-data">{{ formatTokens(r.output_tokens) }}</td>
            <td class="px-4 py-2.5 text-right font-medium text-ink font-data">
              {{ formatCost(r.cost, r.currency) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
interface TopRow {
  id: string
  created_at: string
  user_name: string
  model: string | null
  task_label: string
  conversation_id: string
  conversation_title: string | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number
  cost: number
  currency: string
}

defineProps<{ rows: TopRow[]; pending?: boolean }>()
</script>
