<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden mb-6">
    <div class="px-6 py-4 border-b border-slate-800">
      <h2 class="text-lg font-semibold text-slate-100">Uso por usuario</h2>
      <p class="text-xs text-slate-500 mt-1">Pulsa una fila para ver su desglose por modelo y por tipo de tarea.</p>
    </div>

    <div v-if="pending" class="p-6 text-center text-slate-500 text-sm">Cargando...</div>
    <div v-else-if="!rows.length" class="p-6 text-center text-slate-600 text-sm">Sin uso de IA en este periodo.</div>
    <table v-else class="w-full text-sm">
      <thead class="bg-slate-800 text-slate-500 uppercase text-xs">
        <tr>
          <th class="px-4 py-3 text-left">Usuario</th>
          <th class="px-4 py-3 text-center">Interacciones</th>
          <th class="px-4 py-3 text-right">Tokens entrada</th>
          <th class="px-4 py-3 text-right">Tokens salida</th>
          <th class="px-4 py-3 text-right">Coste</th>
          <th class="px-4 py-3 text-left">Último uso</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-800">
        <template v-for="r in rows" :key="r.user_id">
          <tr @click="toggle(r.user_id)" class="hover:bg-slate-800/50 transition cursor-pointer">
            <td class="px-4 py-3 font-medium text-slate-200">
              <span class="text-slate-600 mr-2 inline-block w-3">{{ expanded === r.user_id ? '▾' : '▸' }}</span>
              {{ r.user_name }}
            </td>
            <td class="px-4 py-3 text-center text-slate-400">{{ formatTokens(r.interactions) }}</td>
            <td class="px-4 py-3 text-right text-sky-300">{{ formatTokens(r.inputTokens) }}</td>
            <td class="px-4 py-3 text-right text-emerald-300">{{ formatTokens(r.outputTokens) }}</td>
            <td class="px-4 py-3 text-right font-medium text-slate-200">{{ formatCost(r.cost) }}</td>
            <td class="px-4 py-3 text-slate-500 text-xs">{{ formatDateTime(r.last_used_at) }}</td>
          </tr>

          <tr v-if="expanded === r.user_id" class="bg-slate-950/60">
            <td colspan="6" class="px-4 py-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Por modelo</p>
                  <div class="space-y-1">
                    <div v-for="m in modelsOf(r.user_id)" :key="m.model"
                      class="flex items-center justify-between text-xs py-1 border-b border-slate-800/60">
                      <span class="font-mono text-violet-300">{{ m.model }}</span>
                      <span class="text-slate-400">
                        {{ formatTokens(m.inputTokens) }} in / {{ formatTokens(m.outputTokens) }} out ·
                        <span class="text-slate-200 font-medium">{{ formatCost(m.cost) }}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Por tipo de tarea</p>
                  <div class="space-y-1">
                    <div v-for="t in tasksOf(r.user_id)" :key="t.context_type"
                      class="flex items-center justify-between text-xs py-1 border-b border-slate-800/60">
                      <span class="text-slate-300">{{ t.task_label }}</span>
                      <span class="text-slate-400">
                        {{ t.interactions }} usos ·
                        <span class="text-slate-200 font-medium">{{ formatCost(t.cost) }}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <p v-if="r.no_breakdown_count" class="text-xs text-amber-500/80 mt-3">
                {{ r.no_breakdown_count }} interacción(es) sin desglose entrada/salida — su coste no está incluido.
              </p>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
/**
 * Per-user usage with an expandable breakdown. The cross tabs come pre-computed
 * from /api/admin/ai-stats, so expanding a row costs no extra request.
 */
interface UserRow {
  user_id: string
  user_name: string
  interactions: number
  inputTokens: number
  outputTokens: number
  cost: number
  no_breakdown_count: number
  last_used_at: string | null
}
interface UserModelRow { user_id: string; model: string; inputTokens: number; outputTokens: number; cost: number }
interface UserTaskRow { user_id: string; context_type: string; task_label: string; interactions: number; cost: number }

const props = defineProps<{
  rows: UserRow[]
  byUserModel: UserModelRow[]
  byUserTask: UserTaskRow[]
  pending?: boolean
}>()

const expanded = ref<string | null>(null)
const toggle = (userId: string) => { expanded.value = expanded.value === userId ? null : userId }

const modelsOf = (userId: string) => props.byUserModel.filter(m => m.user_id === userId)
const tasksOf = (userId: string) => props.byUserTask.filter(t => t.user_id === userId)
</script>
