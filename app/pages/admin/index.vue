<template>
  <div class="max-w-5xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-3xl font-bold text-gray-800">Panel de Administración</h1>
      <span class="text-xs bg-yellow-100 text-yellow-800 px-3 py-1.5 rounded-full font-semibold">Admin</span>
    </div>

    <!-- Summary cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="bg-white rounded-lg shadow p-4 text-center">
        <p class="text-3xl font-bold text-blue-600">{{ users?.length ?? 0 }}</p>
        <p class="text-sm text-gray-500 mt-1">Usuarios</p>
      </div>
      <div class="bg-white rounded-lg shadow p-4 text-center">
        <p class="text-3xl font-bold text-green-600">{{ activeUsers }}</p>
        <p class="text-sm text-gray-500 mt-1">Activos</p>
      </div>
      <div class="bg-white rounded-lg shadow p-4 text-center">
        <p class="text-3xl font-bold text-purple-600">{{ totalTokens.toLocaleString() }}</p>
        <p class="text-sm text-gray-500 mt-1">Tokens totales</p>
      </div>
      <div class="bg-white rounded-lg shadow p-4 text-center">
        <p class="text-3xl font-bold text-orange-600">{{ totalAiConversations }}</p>
        <p class="text-sm text-gray-500 mt-1">Conversaciones IA</p>
      </div>
    </div>

    <!-- Users table -->
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <div class="px-6 py-4 border-b border-gray-100">
        <h2 class="text-lg font-semibold text-gray-800">Usuarios</h2>
      </div>
      <div v-if="pending" class="p-8 text-center text-gray-400">Cargando...</div>
      <div v-else-if="error" class="p-8 text-center text-red-500">Error al cargar usuarios.</div>
      <table v-else class="w-full text-sm">
        <thead class="bg-gray-50 text-gray-500 uppercase text-xs">
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
        <tbody class="divide-y divide-gray-100">
          <tr v-for="u in users" :key="u.id" class="hover:bg-gray-50 transition">
            <td class="px-4 py-3">
              <p class="font-medium text-gray-800">{{ u.name }}</p>
              <p class="text-xs text-gray-400">{{ u.email }}</p>
            </td>
            <td class="px-4 py-3">
              <span :class="u.role === 'admin' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-50 text-blue-700'"
                class="px-2 py-0.5 rounded text-xs font-medium">
                {{ u.role }}
              </span>
            </td>
            <td class="px-4 py-3 text-center text-gray-700">{{ u._count.workouts }}</td>
            <td class="px-4 py-3 text-center text-gray-700">{{ u._count.mesocycles }}</td>
            <td class="px-4 py-3 text-center text-gray-700">{{ u._count.conversations }}</td>
            <td class="px-4 py-3 text-center">
              <span :class="u.tokens_used > 50000 ? 'text-red-600 font-semibold' : u.tokens_used > 10000 ? 'text-orange-600' : 'text-gray-700'">
                {{ u.tokens_used.toLocaleString() }}
              </span>
            </td>
            <td class="px-4 py-3 text-gray-500 text-xs">
              {{ u.last_login_at ? formatDate(u.last_login_at) : 'Nunca' }}
            </td>
            <td class="px-4 py-3 text-center">
              <button v-if="u.role !== 'admin'"
                @click="toggleActive(u)"
                :class="u.is_active ? 'bg-green-100 text-green-700 hover:bg-red-50 hover:text-red-700' : 'bg-red-100 text-red-700 hover:bg-green-50 hover:text-green-700'"
                class="px-2 py-1 rounded text-xs font-medium transition">
                {{ u.is_active ? 'Activo' : 'Inactivo' }}
              </button>
              <span v-else class="text-xs text-gray-400">—</span>
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

const activeUsers = computed(() => (users.value as any[])?.filter((u: any) => u.is_active).length ?? 0)
const totalTokens = computed(() => (users.value as any[])?.reduce((s: number, u: any) => s + (u.tokens_used ?? 0), 0) ?? 0)
const totalAiConversations = computed(() => (users.value as any[])?.reduce((s: number, u: any) => s + (u._count?.ai_conversations ?? 0), 0) ?? 0)

const formatDate = (d: string) => new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const toggleActive = async (u: any) => {
  await $fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } })
  await refresh()
}
</script>
