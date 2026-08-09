<template>
  <div class="max-w-7xl mx-auto">
    <div class="flex items-center justify-between mb-6 gap-4 flex-wrap">
      <h1 class="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] text-ink leading-none">Panel de Administración</h1>
      <span class="text-xs bg-warn/10 text-warn px-3 py-1.5 rounded-full font-semibold">Admin</span>
    </div>

    <div class="mb-6 overflow-x-auto pb-1">
      <UiTabs v-model="tab" :tabs="TABS" />
    </div>

    <!-- Mantenimiento -->
    <template v-if="tab === 'maintenance'">
      <AdminMaintenanceCard :users="userOptions" />
      <AdminUnclassifiedCard />
    </template>

    <!-- Trabajos -->
    <AdminJobsCard v-else-if="tab === 'jobs'" />

    <!-- Usuarios -->
    <AdminUsersCard
      v-else-if="tab === 'users'"
      :users="users"
      :pending="pending"
      :error="error"
      @changed="refresh" />

    <!-- Uso de IA -->
    <template v-else-if="tab === 'ai'">
      <AdminAiRangeFilter :from="range.from" :to="range.to" @change="onRangeChange" />

      <!-- Every figure here respects the selected range. -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div class="bg-surface rounded-card border border-line p-4 text-center">
          <p class="text-2xl font-bold text-ink-2 font-data">{{ formatTokens(totals?.interactions) }}</p>
          <p class="text-xs text-ink-3 mt-1">Interacciones IA</p>
        </div>
        <div class="bg-surface rounded-card border border-line p-4 text-center">
          <p class="text-2xl font-bold text-ink-2 font-data">{{ formatTokens(totals?.inputTokens) }}</p>
          <p class="text-xs text-ink-3 mt-1">Tokens entrada</p>
        </div>
        <div class="bg-surface rounded-card border border-line p-4 text-center">
          <p class="text-2xl font-bold text-positive font-data">{{ formatTokens(totals?.outputTokens) }}</p>
          <p class="text-xs text-ink-3 mt-1">Tokens salida</p>
        </div>
        <div class="bg-surface rounded-card border border-line p-4 text-center">
          <p class="text-2xl font-bold text-ink-2 font-data">{{ formatCost(totals?.cost) }}</p>
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
    </template>

    <!-- Base de datos -->
    <AdminDbExplorerCard v-else-if="tab === 'db'" />
  </div>
</template>

<script setup lang="ts">
import type { AdminUser } from '~/utils/admin'

definePageMeta({ middleware: 'admin' })

/**
 * Four questions, four places to ask them, plus the raw data underneath. The
 * panel used to be one column of ten cards, which meant scrolling past a month
 * of token costs to reach a maintenance operation.
 */
const TABS = [
  { value: 'maintenance', label: 'Mantenimiento' },
  { value: 'jobs', label: 'Trabajos' },
  { value: 'users', label: 'Usuarios' },
  { value: 'ai', label: 'Uso de IA' },
  { value: 'db', label: 'Base de datos' }
] as const

const TAB_VALUES = TABS.map(t => t.value) as readonly string[]

// The tab lives in the query so it survives a reload and can be linked to
// (`/admin?tab=db`) — a panel this deep is worth a URL.
const route = useRoute()
const router = useRouter()
const tab = computed({
  get: () => (TAB_VALUES.includes(route.query.tab as string) ? (route.query.tab as string) : 'maintenance'),
  set: (v: string) => { router.replace({ query: { ...route.query, tab: v } }) }
})

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

// Both fetches stay on the page rather than moving into their tab: `userOptions`
// feeds the maintenance target selector *and* the AI usage log, which live in
// different tabs, and a `useFetch` inside a `v-if` would re-run on every switch.
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
</script>
