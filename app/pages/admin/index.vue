<template>
  <div class="max-w-7xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <h1 class="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] text-ink leading-none">Panel de Administración</h1>
      <span class="text-xs bg-warn/10 text-warn px-3 py-1.5 rounded-full font-semibold">Admin</span>
    </div>

    <AdminMaintenanceCard :users="userOptions" />

    <AdminUnclassifiedCard />

    <AdminAiRangeFilter :from="range.from" :to="range.to" @change="onRangeChange" />

    <!-- Summary cards. Users/actives are absolute; every AI figure respects the range. -->
    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
      <div class="bg-surface rounded-card border border-line p-4 text-center">
        <p class="text-2xl font-bold text-ink-2">{{ users?.length ?? 0 }}</p>
        <p class="text-xs text-ink-3 mt-1">Usuarios</p>
      </div>
      <div class="bg-surface rounded-card border border-line p-4 text-center">
        <p class="text-2xl font-bold text-positive">{{ activeUsers }}</p>
        <p class="text-xs text-ink-3 mt-1">Activos</p>
      </div>
      <div class="bg-surface rounded-card border border-line p-4 text-center">
        <p class="text-2xl font-bold text-ink-2">{{ formatTokens(totals?.interactions) }}</p>
        <p class="text-xs text-ink-3 mt-1">Interacciones IA</p>
      </div>
      <div class="bg-surface rounded-card border border-line p-4 text-center">
        <p class="text-2xl font-bold text-ink-2">{{ formatTokens(totals?.inputTokens) }}</p>
        <p class="text-xs text-ink-3 mt-1">Tokens entrada</p>
      </div>
      <div class="bg-surface rounded-card border border-line p-4 text-center">
        <p class="text-2xl font-bold text-positive">{{ formatTokens(totals?.outputTokens) }}</p>
        <p class="text-xs text-ink-3 mt-1">Tokens salida</p>
      </div>
      <div class="bg-surface rounded-card border border-line p-4 text-center">
        <p class="text-2xl font-bold text-ink-2">{{ formatCost(totals?.cost) }}</p>
        <p class="text-xs text-ink-3 mt-1">Coste estimado</p>
      </div>
    </div>

    <!-- Says out loud what the cost total leaves out, so a partial figure is never
         read as complete. -->
    <div v-if="costCaveats.length" class="bg-warn/10 border border-warn/40 rounded-card px-5 py-3 mb-6">
      <p class="text-sm text-warn font-medium">El coste mostrado es parcial</p>
      <ul class="text-xs text-warn/80 mt-1 space-y-0.5 list-disc list-inside">
        <li v-for="c in costCaveats" :key="c">{{ c }}</li>
      </ul>
    </div>

    <AdminAiRunRateCard :mtd="stats?.month_to_date" :totals="stats?.totals" />

    <AdminAiUsageTrendChart
      :buckets="stats?.timeline?.buckets ?? []"
      :series="stats?.timeline?.series ?? []"
      :granularity="stats?.timeline?.granularity ?? 'day'"
      :pending="statsPending" />

    <AdminAiModelPricesCard @changed="refreshStats" />

    <AdminAiUsageByModelCard :rows="stats?.by_model ?? []" :pending="statsPending" />

    <AdminAiUsageByUserCard
      :rows="stats?.by_user ?? []"
      :by-user-model="stats?.by_user_model ?? []"
      :by-user-task="stats?.by_user_task ?? []"
      :pending="statsPending" />

    <AdminAiTopInteractionsCard :rows="stats?.top_interactions ?? []" :pending="statsPending" />

    <AdminAiUsageLogCard
      :from="range.from"
      :to="range.to"
      :users="userOptions"
      :models="modelOptions" />

    <!-- Users table -->
    <div class="bg-surface rounded-card border border-line overflow-hidden">
      <div class="px-5 py-3.5 border-b border-line">
        <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Usuarios</h2>
        <p class="text-xs text-ink-3 mt-1">Consumo de IA acumulado (histórico completo, no filtrado por periodo).</p>
      </div>
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
              <td class="px-4 py-2.5 text-center text-ink-2">{{ u._count.workouts }}</td>
              <td class="px-4 py-2.5 text-center text-ink-2">{{ u._count.mesocycles }}</td>
              <td class="px-4 py-2.5 text-center text-ink-2">{{ u._count.conversations }}</td>
              <td class="px-4 py-2.5 text-right">
                <span :class="u.tokens_used > 500000 ? 'text-danger font-semibold' : u.tokens_used > 100000 ? 'text-ink-2' : 'text-ink-2'">
                  {{ formatTokens(u.tokens_used) }}
                </span>
                <span class="block text-xs text-ink-3">
                  {{ formatTokens(u.input_tokens) }} in / {{ formatTokens(u.output_tokens) }} out
                </span>
              </td>
              <td class="px-4 py-2.5 text-right font-medium text-ink-2">{{ formatCost(u.ai_cost) }}</td>
              <td class="px-4 py-2.5 text-ink-3 text-xs">{{ formatDateShort(u.last_ai_use_at) }}</td>
              <td class="px-4 py-2.5 text-ink-3 text-xs">{{ formatDateTime(u.last_login_at) }}</td>
              <td class="px-4 py-2.5 text-center">
                <button v-if="u.role !== 'admin'"
                  @click="toggleActive(u)"
                  :class="u.is_active ? 'bg-positive/10 text-positive hover:bg-danger/10 hover:text-danger' : 'bg-danger/10 text-danger hover:bg-positive/10 hover:text-positive'"
                  class="px-2 py-1 rounded text-xs font-medium transition">
                  {{ u.is_active ? 'Activo' : 'Inactivo' }}
                </button>
                <span v-else class="text-xs text-ink-3">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

interface AdminUser {
  id: string
  name: string
  email: string
  role: string
  is_active: boolean
  last_login_at: string | null
  last_ai_use_at: string | null
  tokens_used: number
  input_tokens: number
  output_tokens: number
  ai_cost: number
  _count: { workouts: number; mesocycles: number; conversations: number }
}

interface StatsTotals {
  interactions: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number
  unpriced_count: number
  no_breakdown_count: number
}

/** Defaults to the last 30 days — matching AiRangeFilter's initial highlight. */
const initialRange = () => {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

const range = ref<{ from: string | null; to: string | null }>(initialRange())
const onRangeChange = (next: { from: string | null; to: string | null }) => { range.value = next }

const { data: users, pending, error, refresh } = useFetch<AdminUser[]>('/api/admin/users')

const statsQuery = computed(() => ({
  from: range.value.from ?? undefined,
  to: range.value.to ?? undefined
}))

const { data: stats, pending: statsPending, refresh: refreshStatsData } = useFetch<{
  totals: StatsTotals
  by_model: any[]
  by_user: any[]
  by_user_model: any[]
  by_user_task: any[]
  by_task: any[]
  unpriced_models: string[]
  timeline: { granularity: 'day' | 'week'; series: any[]; buckets: any[] }
  month_to_date: {
    cost: number
    tokens: number
    interactions: number
    days_elapsed: number
    days_in_month: number
    projected_cost: number
  }
  top_interactions: any[]
}>('/api/admin/ai-stats', { query: statsQuery })

const totals = computed(() => stats.value?.totals)

/** A price edit changes every cost figure, including the per-user table. */
const refreshStats = async () => { await Promise.all([refreshStatsData(), refresh()]) }

const activeUsers = computed(() => users.value?.filter(u => u.is_active).length ?? 0)

const userOptions = computed(() => (users.value ?? []).map(u => ({ id: u.id, name: u.name })))
const modelOptions = computed(() => (stats.value?.by_model ?? []).map((m: any) => m.model as string))

const costCaveats = computed(() => {
  const t = totals.value
  if (!t) return []
  const caveats: string[] = []
  if (t.no_breakdown_count) {
    caveats.push(`${t.no_breakdown_count} interacción(es) anteriores al registro de tokens entrada/salida — no se pueden costear.`)
  }
  const unpriced = stats.value?.unpriced_models ?? []
  if (unpriced.length) {
    caveats.push(`Modelos sin precio configurado: ${unpriced.join(', ')}.`)
  }
  return caveats
})

const toggleActive = async (u: AdminUser) => {
  await $fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } })
  await refresh()
}
</script>
