<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden mb-6">
    <div class="px-6 py-4 border-b border-slate-800">
      <h2 class="text-lg font-semibold text-slate-100">Interacciones más caras</h2>
      <p class="text-xs text-slate-500 mt-1">
        Las {{ rows.length || 10 }} llamadas de mayor coste del periodo. Útil para cazar conversaciones
        que arrastran demasiado contexto.
      </p>
    </div>

    <div v-if="pending" class="p-6 text-center text-slate-500 text-sm">Cargando...</div>
    <div v-else-if="!rows.length" class="p-6 text-center text-slate-600 text-sm">
      Sin interacciones con coste calculable en este periodo.
    </div>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-800 text-slate-500 uppercase text-xs">
          <tr>
            <th class="px-4 py-3 text-left">#</th>
            <th class="px-4 py-3 text-left">Fecha</th>
            <th class="px-4 py-3 text-left">Usuario</th>
            <th class="px-4 py-3 text-left">Tarea</th>
            <th class="px-4 py-3 text-right">Entrada</th>
            <th class="px-4 py-3 text-right">Salida</th>
            <th class="px-4 py-3 text-right">Coste</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800">
          <tr v-for="(r, i) in rows" :key="r.id" class="hover:bg-slate-800/50 transition">
            <td class="px-4 py-3 text-slate-600 tabular-nums">{{ i + 1 }}</td>
            <td class="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{{ formatDateTime(r.created_at) }}</td>
            <td class="px-4 py-3">
              <p class="text-slate-300">{{ r.user_name }}</p>
              <p v-if="r.conversation_title" class="text-xs text-slate-600 truncate max-w-[12rem]"
                :title="r.conversation_title">{{ r.conversation_title }}</p>
            </td>
            <td class="px-4 py-3">
              <span class="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded">{{ r.task_label }}</span>
            </td>
            <td class="px-4 py-3 text-right text-sky-300 tabular-nums">{{ formatTokens(r.input_tokens) }}</td>
            <td class="px-4 py-3 text-right text-emerald-300 tabular-nums">{{ formatTokens(r.output_tokens) }}</td>
            <td class="px-4 py-3 text-right font-medium text-slate-100 tabular-nums">
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
