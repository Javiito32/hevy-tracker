<template>
  <div class="max-w-5xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-3xl font-bold text-slate-100">Panel de Administración</h1>
      <span class="text-xs bg-amber-950/60 text-amber-400 px-3 py-1.5 rounded-full font-semibold">Admin</span>
    </div>

    <!-- Summary cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-slate-900 rounded-xl border border-slate-800 p-4 text-center">
        <p class="text-3xl font-bold text-indigo-400">{{ users?.length ?? 0 }}</p>
        <p class="text-sm text-slate-500 mt-1">Usuarios</p>
      </div>
      <div class="bg-slate-900 rounded-xl border border-slate-800 p-4 text-center">
        <p class="text-3xl font-bold text-emerald-400">{{ activeUsers }}</p>
        <p class="text-sm text-slate-500 mt-1">Activos</p>
      </div>
      <div class="bg-slate-900 rounded-xl border border-slate-800 p-4 text-center">
        <p class="text-3xl font-bold text-violet-400">{{ totalTokens.toLocaleString() }}</p>
        <p class="text-sm text-slate-500 mt-1">Tokens totales</p>
      </div>
      <div class="bg-slate-900 rounded-xl border border-slate-800 p-4 text-center">
        <p class="text-3xl font-bold text-orange-400">{{ totalAiConversations }}</p>
        <p class="text-sm text-slate-500 mt-1">Conversaciones IA</p>
      </div>
    </div>

    <!-- AI Models section -->
    <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden mb-6">
      <div class="px-6 py-4 border-b border-slate-800 flex items-center gap-3">
        <h2 class="text-lg font-semibold text-slate-100">Modelos LLM utilizados</h2>
        <span class="text-xs bg-violet-950/60 text-violet-400 px-2 py-0.5 rounded font-medium">Solo admin</span>
      </div>
      <div v-if="aiStatsPending" class="p-6 text-center text-slate-500 text-sm">Cargando...</div>
      <div v-else-if="!aiStats?.length" class="p-6 text-center text-slate-600 text-sm">Sin datos todavía.</div>
      <table v-else class="w-full text-sm">
        <thead class="bg-slate-800 text-slate-500 uppercase text-xs">
          <tr>
            <th class="px-4 py-3 text-left">Modelo</th>
            <th class="px-4 py-3 text-center">Respuestas IA</th>
            <th class="px-4 py-3 text-center">Tokens totales</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800">
          <tr v-for="s in aiStats" :key="s.model" class="hover:bg-slate-800/50 transition">
            <td class="px-4 py-3">
              <span class="font-mono text-sm font-semibold text-violet-300">{{ s.model }}</span>
            </td>
            <td class="px-4 py-3 text-center text-slate-400">{{ s.messages.toLocaleString() }}</td>
            <td class="px-4 py-3 text-center text-slate-400">{{ s.tokens.toLocaleString() }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Users table -->
    <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-800">
        <h2 class="text-lg font-semibold text-slate-100">Usuarios</h2>
      </div>
      <div v-if="pending" class="p-8 text-center text-slate-500">Cargando...</div>
      <div v-else-if="error" class="p-8 text-center text-rose-400">Error al cargar usuarios.</div>
      <table v-else class="w-full text-sm">
        <thead class="bg-slate-800 text-slate-500 uppercase text-xs">
          <tr>
            <th class="px-4 py-3 text-left">Usuario</th>
            <th class="px-4 py-3 text-left">Rol</th>
            <th class="px-4 py-3 text-center">Entrenos</th>
            <th class="px-4 py-3 text-center">Mesos</th>
            <th class="px-4 py-3 text-center">Conv. IA</th>
            <th class="px-4 py-3 text-center">Tokens</th>
            <th class="px-4 py-3 text-left">Último acceso</th>
            <th class="px-4 py-3 text-center">Estado</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800">
          <tr v-for="u in users" :key="u.id" class="hover:bg-slate-800/50 transition">
            <td class="px-4 py-3">
              <p class="font-medium text-slate-200">{{ u.name }}</p>
              <p class="text-xs text-slate-500">{{ u.email }}</p>
            </td>
            <td class="px-4 py-3">
              <span :class="u.role === 'admin' ? 'bg-amber-950/60 text-amber-400' : 'bg-indigo-950/60 text-indigo-400'"
                class="px-2 py-0.5 rounded text-xs font-medium">
                {{ u.role }}
              </span>
            </td>
            <td class="px-4 py-3 text-center text-slate-400">{{ u._count.workouts }}</td>
            <td class="px-4 py-3 text-center text-slate-400">{{ u._count.mesocycles }}</td>
            <td class="px-4 py-3 text-center text-slate-400">{{ u._count.conversations }}</td>
            <td class="px-4 py-3 text-center">
              <span :class="u.tokens_used > 50000 ? 'text-rose-400 font-semibold' : u.tokens_used > 10000 ? 'text-orange-400' : 'text-slate-400'">
                {{ u.tokens_used.toLocaleString() }}
              </span>
            </td>
            <td class="px-4 py-3 text-slate-500 text-xs">
              {{ u.last_login_at ? formatDate(u.last_login_at) : 'Nunca' }}
            </td>
            <td class="px-4 py-3 text-center">
              <button v-if="u.role !== 'admin'"
                @click="toggleActive(u)"
                :class="u.is_active ? 'bg-emerald-950/60 text-emerald-400 hover:bg-rose-950/60 hover:text-rose-400' : 'bg-rose-950/60 text-rose-400 hover:bg-emerald-950/60 hover:text-emerald-400'"
                class="px-2 py-1 rounded text-xs font-medium transition">
                {{ u.is_active ? 'Activo' : 'Inactivo' }}
              </button>
              <span v-else class="text-xs text-slate-600">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin' })

const { data: users, pending, error, refresh } = useFetch('/api/admin/users')
const { data: aiStats, pending: aiStatsPending } = useFetch('/api/admin/ai-stats')

const activeUsers = computed(() => (users.value as any[])?.filter((u: any) => u.is_active).length ?? 0)
const totalTokens = computed(() => (users.value as any[])?.reduce((s: number, u: any) => s + (u.tokens_used ?? 0), 0) ?? 0)
const totalAiConversations = computed(() => (users.value as any[])?.reduce((s: number, u: any) => s + (u._count?.ai_conversations ?? 0), 0) ?? 0)

const formatDate = (d: string) => new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const toggleActive = async (u: any) => {
  await $fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } })
  await refresh()
}
</script>
