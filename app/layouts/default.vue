<template>
  <div class="min-h-screen bg-slate-950 flex flex-col font-sans">
    <!-- Navbar -->
    <header class="bg-slate-950/95 backdrop-blur-md border-b border-slate-800 text-slate-100 sticky top-0 z-40">
      <div class="container mx-auto px-4 py-3 flex justify-between items-center">
        <NuxtLink to="/" class="text-xl font-bold flex items-center gap-2 text-white hover:text-indigo-400 transition">
          <span>🏋️</span> HevyTracker
        </NuxtLink>

        <nav class="flex items-center gap-5 text-sm">
          <NuxtLink to="/" class="text-slate-400 hover:text-indigo-400 transition">Dashboard</NuxtLink>
          <NuxtLink to="/calendar" class="text-slate-400 hover:text-indigo-400 transition">Calendar</NuxtLink>
          <NuxtLink to="/mesocycles" class="text-slate-400 hover:text-indigo-400 transition">Mesociclos</NuxtLink>
          <NuxtLink to="/macrocycles" class="text-slate-400 hover:text-indigo-400 transition">Macrociclos</NuxtLink>
          <NuxtLink to="/progress" class="text-slate-400 hover:text-indigo-400 transition">Progreso</NuxtLink>
          <NuxtLink to="/body" class="text-slate-400 hover:text-indigo-400 transition">Métricas</NuxtLink>
          <NuxtLink to="/chat" class="text-slate-400 hover:text-indigo-400 transition">AI Coach</NuxtLink>
          <NuxtLink to="/settings" class="text-slate-400 hover:text-indigo-400 transition">Ajustes</NuxtLink>
          <NuxtLink v-if="isAdmin" to="/admin" class="text-slate-400 hover:text-indigo-400 transition font-medium">Admin</NuxtLink>

          <button
            @click="syncHevy"
            :disabled="isSyncing"
            class="bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-60 transition px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 text-slate-300"
          >
            <span :class="isSyncing ? 'animate-spin' : ''">🔄</span>
            {{ isSyncing ? 'Sincronizando...' : 'Sincronizar' }}
          </button>

          <!-- User menu -->
          <div class="relative" ref="userMenuRef">
            <button @click="userMenuOpen = !userMenuOpen"
              class="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg transition text-sm text-slate-200">
              <span class="font-medium">{{ session?.user?.name ?? 'Usuario' }}</span>
              <span v-if="isAdmin" class="text-xs bg-amber-500 text-amber-950 px-1.5 py-0.5 rounded font-bold">Admin</span>
              <svg class="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div v-if="userMenuOpen"
              class="absolute right-0 mt-2 w-44 bg-slate-900 rounded-lg shadow-xl border border-slate-700 text-slate-300 z-50 py-1 text-sm">
              <div class="px-3 py-2 border-b border-slate-800">
                <p class="font-medium text-slate-100 truncate">{{ session?.user?.name }}</p>
                <p class="text-xs text-slate-500 truncate">{{ session?.user?.email }}</p>
              </div>
              <NuxtLink to="/settings" @click="userMenuOpen = false"
                class="block px-3 py-2 hover:bg-slate-800 hover:text-slate-100 transition">Ajustes</NuxtLink>
              <NuxtLink v-if="isAdmin" to="/admin" @click="userMenuOpen = false"
                class="block px-3 py-2 hover:bg-slate-800 hover:text-slate-100 transition">Panel Admin</NuxtLink>
              <button @click="handleLogout"
                class="w-full text-left px-3 py-2 text-rose-400 hover:bg-rose-950/50 transition">
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
    <footer class="bg-slate-950 border-t border-slate-800 text-slate-600 py-6 text-center text-sm">
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
