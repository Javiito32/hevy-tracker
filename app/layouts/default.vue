<template>
  <div class="min-h-screen bg-gray-50 flex flex-col">
    <!-- Navbar -->
    <header class="bg-blue-600 text-white shadow-md">
      <div class="container mx-auto px-4 py-3 flex justify-between items-center">
        <NuxtLink to="/" class="text-xl font-bold flex items-center gap-2">
          <span>🏋️</span> HevyTracker
        </NuxtLink>

        <nav class="flex items-center gap-5 text-sm">
          <NuxtLink to="/" class="hover:text-blue-200 transition">Dashboard</NuxtLink>
          <NuxtLink to="/calendar" class="hover:text-blue-200 transition">Calendar</NuxtLink>
          <NuxtLink to="/mesocycles" class="hover:text-blue-200 transition">Mesociclos</NuxtLink>
          <NuxtLink to="/macrocycles" class="hover:text-blue-200 transition">Macrociclos</NuxtLink>
          <NuxtLink to="/progress" class="hover:text-blue-200 transition">Progreso</NuxtLink>
          <NuxtLink to="/chat" class="hover:text-blue-200 transition">AI Coach</NuxtLink>
          <NuxtLink to="/settings" class="hover:text-blue-200 transition">Ajustes</NuxtLink>
          <NuxtLink v-if="isAdmin" to="/admin" class="hover:text-blue-200 transition font-medium">Admin</NuxtLink>

          <button
            @click="syncHevy"
            :disabled="isSyncing"
            class="bg-blue-800 hover:bg-blue-700 disabled:opacity-60 transition px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 shadow-sm"
          >
            <span :class="isSyncing ? 'animate-spin' : ''">🔄</span>
            {{ isSyncing ? 'Sincronizando...' : 'Sincronizar' }}
          </button>

          <!-- User menu -->
          <div class="relative" ref="userMenuRef">
            <button @click="userMenuOpen = !userMenuOpen"
              class="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 px-3 py-1.5 rounded-lg transition text-sm">
              <span class="font-medium">{{ session?.user?.name ?? 'Usuario' }}</span>
              <span v-if="isAdmin" class="text-xs bg-yellow-400 text-yellow-900 px-1.5 py-0.5 rounded font-bold">Admin</span>
              <svg class="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div v-if="userMenuOpen"
              class="absolute right-0 mt-2 w-44 bg-white rounded-lg shadow-lg border border-gray-100 text-gray-700 z-50 py-1 text-sm">
              <div class="px-3 py-2 border-b border-gray-100">
                <p class="font-medium text-gray-800 truncate">{{ session?.user?.name }}</p>
                <p class="text-xs text-gray-500 truncate">{{ session?.user?.email }}</p>
              </div>
              <NuxtLink to="/settings" @click="userMenuOpen = false"
                class="block px-3 py-2 hover:bg-gray-50 transition">Ajustes</NuxtLink>
              <NuxtLink v-if="isAdmin" to="/admin" @click="userMenuOpen = false"
                class="block px-3 py-2 hover:bg-gray-50 transition">Panel Admin</NuxtLink>
              <button @click="handleLogout"
                class="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50 transition">
                Cerrar sesión
              </button>
            </div>
          </div>
        </nav>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-grow container mx-auto px-4 py-8">
      <slot />
    </main>

    <!-- Footer -->
    <footer class="bg-gray-800 text-gray-400 py-6 text-center text-sm">
      <p>&copy; 2026 HevyTracker AI. Your personal workout analyst.</p>
    </footer>
  </div>
</template>

<script setup lang="ts">
const { session, clear } = useUserSession()
const isAdmin = computed(() => (session.value?.user as any)?.role === 'admin')

const isSyncing = ref(false)
const userMenuOpen = ref(false)
const userMenuRef = ref<HTMLElement | null>(null)

onMounted(() => {
  document.addEventListener('click', (e) => {
    if (userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) {
      userMenuOpen.value = false
    }
  })
})

const syncHevy = async () => {
  if (isSyncing.value) return
  isSyncing.value = true
  try {
    const res = await $fetch('/api/sync', { method: 'POST' }) as any
    if (res.success) {
      alert(`Sincronización completada.\nEntrenos: ${res.syncedWorkouts} | Medidas: ${res.syncedMetrics}`)
      window.location.reload()
    } else {
      alert(`Aviso: ${res.message}`)
    }
  } catch {
    alert('Error al intentar sincronizar con Hevy.')
  } finally {
    isSyncing.value = false
  }
}

const handleLogout = async () => {
  userMenuOpen.value = false
  try {
    await $fetch('/auth/logout', { method: 'POST' })
  } catch {}
  window.location.href = '/login'
}
</script>
