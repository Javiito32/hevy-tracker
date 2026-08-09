<template>
  <div>
    <div class="grid grid-cols-2 gap-4 mb-6 max-w-sm">
      <div class="bg-surface rounded-card border border-line p-4 text-center">
        <p class="text-2xl font-bold text-ink-2 font-data">{{ users?.length ?? 0 }}</p>
        <p class="text-xs text-ink-3 mt-1">Usuarios</p>
      </div>
      <div class="bg-surface rounded-card border border-line p-4 text-center">
        <p class="text-2xl font-bold text-positive font-data">{{ activeUsers }}</p>
        <p class="text-xs text-ink-3 mt-1">Activos</p>
      </div>
    </div>

    <UiCard
      eyebrow="Cuentas"
      title="Usuarios"
      hint="Consumo de IA acumulado (histórico completo, no filtrado por periodo)."
      flush
    >
      <div v-if="pending" class="py-12 flex justify-center text-ink-3"><UiSpinner size="lg" /></div>
      <div v-else-if="error" class="p-8 text-center text-danger">Error al cargar usuarios.</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-surface-2 text-ink-3 uppercase text-[11px] tracking-wide">
            <tr>
              <th class="px-4 py-2.5 text-left font-semibold">Usuario</th>
              <th class="px-4 py-2.5 text-left font-semibold">Rol</th>
              <th class="px-4 py-2.5 text-center font-semibold">Entrenos</th>
              <th class="px-4 py-2.5 text-center font-semibold">Mesos</th>
              <th class="px-4 py-2.5 text-center font-semibold">Conv. IA</th>
              <th class="px-4 py-2.5 text-right font-semibold">Tokens</th>
              <th class="px-4 py-2.5 text-right font-semibold">Coste</th>
              <th class="px-4 py-2.5 text-left font-semibold">Último uso IA</th>
              <th class="px-4 py-2.5 text-left font-semibold">Último acceso</th>
              <th class="px-4 py-2.5 text-center font-semibold">Estado</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            <tr v-for="u in users" :key="u.id" class="hover:bg-surface-2 transition">
              <td class="px-4 py-3">
                <p class="font-medium text-ink">{{ u.name }}</p>
                <p class="text-xs text-ink-3">{{ u.email }}</p>
              </td>
              <td class="px-4 py-3">
                <span :class="u.role === 'admin' ? 'bg-warn/10 text-warn' : 'bg-surface-2 text-ink-2'"
                  class="px-2 py-0.5 rounded text-xs font-medium">
                  {{ u.role }}
                </span>
              </td>
              <td class="px-4 py-2.5 text-center text-ink-2 font-data">{{ u._count.workouts }}</td>
              <td class="px-4 py-2.5 text-center text-ink-2 font-data">{{ u._count.mesocycles }}</td>
              <td class="px-4 py-2.5 text-center text-ink-2 font-data">{{ u._count.conversations }}</td>
              <td class="px-4 py-2.5 text-right font-data">
                <span :class="u.tokens_used > 500000 ? 'text-danger font-semibold' : 'text-ink-2'">
                  {{ formatTokens(u.tokens_used) }}
                </span>
                <span class="block text-xs text-ink-3">
                  {{ formatTokens(u.input_tokens) }} in / {{ formatTokens(u.output_tokens) }} out
                </span>
              </td>
              <td class="px-4 py-2.5 text-right font-medium text-ink-2 font-data">{{ formatCost(u.ai_cost) }}</td>
              <td class="px-4 py-2.5 text-ink-3 text-xs font-data">{{ formatDateShort(u.last_ai_use_at) }}</td>
              <td class="px-4 py-2.5 text-ink-3 text-xs font-data">{{ formatDateTime(u.last_login_at) }}</td>
              <td class="px-4 py-2.5 text-center">
                <button v-if="u.role !== 'admin'"
                  @click="toggleActive(u)"
                  :class="u.is_active ? 'bg-positive/10 text-positive hover:bg-danger/10 hover:text-danger' : 'bg-danger/10 text-danger hover:bg-positive/10 hover:text-positive'"
                  class="px-2 py-1 rounded text-xs font-medium transition">
                  {{ u.is_active ? 'Activo' : 'Inactivo' }}
                </button>
                <span v-else class="text-xs text-ink-3">{{ NO_VALUE }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiCard>
  </div>
</template>

<script setup lang="ts">
import type { AdminUser } from '~/utils/admin'

/**
 * The accounts table, moved out of `admin/index.vue` when the panel grew tabs.
 * The page still owns the fetch — `userOptions` feeds the maintenance target
 * selector and the AI usage log — so this component receives rows and emits
 * upward when it changes one.
 */
const props = defineProps<{
  users: AdminUser[] | null
  pending: boolean
  error: unknown
}>()

const emit = defineEmits<{ changed: [] }>()

const activeUsers = computed(() => props.users?.filter(u => u.is_active).length ?? 0)

const toggleActive = async (u: AdminUser) => {
  await $fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } })
  emit('changed')
}
</script>
