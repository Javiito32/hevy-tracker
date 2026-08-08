<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden mb-6">
    <div class="px-5 py-3.5 border-b border-line">
      <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Uso por usuario</h2>
      <p class="text-xs text-ink-3 mt-1">Pulsa una fila para ver su desglose por modelo y por tipo de tarea.</p>
    </div>

    <div v-if="pending" class="py-10 flex justify-center text-ink-3"><UiSpinner /></div>
    <UiEmptyState v-else-if="!rows.length" title="Sin uso de IA en este periodo." />
    <table v-else class="w-full text-sm">
      <thead class="bg-surface-2 text-ink-3 uppercase text-[11px] tracking-wide">
        <tr>
          <th class="px-4 py-2.5 text-left font-semibold">Usuario</th>
          <th class="px-4 py-2.5 text-center font-semibold">Interacciones</th>
          <th class="px-4 py-2.5 text-right font-semibold">Tokens entrada</th>
          <th class="px-4 py-2.5 text-right font-semibold">Tokens salida</th>
          <th class="px-4 py-2.5 text-right font-semibold">Coste</th>
          <th class="px-4 py-2.5 text-left font-semibold">Último uso</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line">
        <template v-for="r in rows" :key="r.user_id">
          <tr @click="toggle(r.user_id)" class="hover:bg-surface-2 transition cursor-pointer">
            <td class="px-4 py-2.5 font-medium text-ink">
              <span class="text-ink-3 mr-2 inline-block w-3">{{ expanded === r.user_id ? '▾' : '▸' }}</span>
              {{ r.user_name }}
            </td>
            <td class="px-4 py-2.5 text-center text-ink-2">{{ formatTokens(r.interactions) }}</td>
            <td class="px-4 py-2.5 text-right text-ink-2">{{ formatTokens(r.inputTokens) }}</td>
            <td class="px-4 py-2.5 text-right text-positive">{{ formatTokens(r.outputTokens) }}</td>
            <td class="px-4 py-2.5 text-right font-medium text-ink">{{ formatCost(r.cost) }}</td>
            <td class="px-4 py-2.5 text-ink-3 text-xs">{{ formatDateTime(r.last_used_at) }}</td>
          </tr>

          <tr v-if="expanded === r.user_id" class="bg-bg/60">
            <td colspan="6" class="px-4 py-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-2">Por modelo</p>
                  <div class="space-y-1">
                    <div v-for="m in modelsOf(r.user_id)" :key="m.model"
                      class="flex items-center justify-between text-xs py-1 border-b border-line/60">
                      <span class="font-mono text-ink-2">{{ m.model }}</span>
                      <span class="text-ink-2">
                        {{ formatTokens(m.inputTokens) }} in / {{ formatTokens(m.outputTokens) }} out ·
                        <span class="text-ink font-medium">{{ formatCost(m.cost) }}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div>
                  <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-2">Por tipo de tarea</p>
                  <div class="space-y-1">
                    <div v-for="t in tasksOf(r.user_id)" :key="t.context_type"
                      class="flex items-center justify-between text-xs py-1 border-b border-line/60">
                      <span class="text-ink-2">{{ t.task_label }}</span>
                      <span class="text-ink-2">
                        {{ t.interactions }} usos ·
                        <span class="text-ink font-medium">{{ formatCost(t.cost) }}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <p v-if="r.no_breakdown_count" class="text-xs text-warn/80 mt-3">
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
