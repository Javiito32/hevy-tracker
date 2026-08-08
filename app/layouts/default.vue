<template>
  <div class="min-h-screen bg-slate-950 flex flex-col font-sans">
    <!-- Navbar -->
    <header class="bg-slate-950/95 backdrop-blur-md border-b border-slate-800 text-slate-100 sticky top-0 z-40">
      <div class="container mx-auto px-4 py-3 flex justify-between items-center gap-3">
        <NuxtLink to="/" class="text-xl font-bold flex items-center gap-2 text-white hover:text-indigo-400 transition flex-shrink-0">
          <span>🏋️</span> <span class="hidden sm:inline">HevyTracker</span>
        </NuxtLink>

        <!-- Desktop nav -->
        <nav class="hidden lg:flex items-center gap-4 text-sm">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            class="text-slate-400 hover:text-indigo-400 transition whitespace-nowrap"
          >{{ link.label }}</NuxtLink>
          <NuxtLink v-if="isAdmin" to="/admin" class="text-slate-400 hover:text-indigo-400 transition font-medium">Admin</NuxtLink>
        </nav>

        <div class="flex items-center gap-2 flex-shrink-0">
          <!-- Sync. Shows live progress instead of freezing behind an alert(). -->
          <button
            @click="syncHevy"
            :disabled="isSyncing"
            class="bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-60 transition px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 text-slate-300"
            :title="syncStatus || 'Sincronizar con Hevy'"
          >
            <span :class="isSyncing ? 'animate-spin inline-block' : ''">🔄</span>
            <span class="hidden md:inline">{{ isSyncing ? (syncStatus || 'Sincronizando…') : 'Sincronizar' }}</span>
          </button>

          <!-- User menu -->
          <div class="relative" ref="userMenuRef">
            <button
              @click="userMenuOpen = !userMenuOpen"
              class="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2.5 py-1.5 rounded-lg transition text-sm text-slate-200"
            >
              <span class="font-medium hidden sm:inline max-w-[8rem] truncate">{{ session?.user?.name ?? 'Usuario' }}</span>
              <span class="sm:hidden">👤</span>
              <span v-if="isAdmin" class="text-xs bg-amber-500 text-amber-950 px-1.5 py-0.5 rounded font-bold hidden sm:inline">Admin</span>
              <svg class="w-4 h-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div v-if="userMenuOpen"
              class="absolute right-0 mt-2 w-48 bg-slate-900 rounded-lg shadow-xl border border-slate-700 text-slate-300 z-50 py-1 text-sm">
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

          <!-- Hamburger: the nav has ten destinations and this app is used in a
               gym, on a phone. Below lg they live behind this. -->
          <button
            @click="mobileNavOpen = !mobileNavOpen"
            class="lg:hidden bg-slate-800 border border-slate-700 rounded-lg p-2 text-slate-300 hover:bg-slate-700 transition"
            :aria-expanded="mobileNavOpen"
            aria-label="Abrir menú de navegación"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path v-if="!mobileNavOpen" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Mobile nav -->
      <nav v-if="mobileNavOpen" class="lg:hidden border-t border-slate-800 bg-slate-950">
        <div class="container mx-auto px-4 py-2 grid grid-cols-2 sm:grid-cols-3 gap-1">
          <NuxtLink
            v-for="link in navLinks"
            :key="link.to"
            :to="link.to"
            @click="mobileNavOpen = false"
            class="px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-slate-800 hover:text-indigo-400 transition"
          >{{ link.label }}</NuxtLink>
          <NuxtLink
            v-if="isAdmin"
            to="/admin"
            @click="mobileNavOpen = false"
            class="px-3 py-2.5 rounded-lg text-sm text-amber-400 hover:bg-slate-800 transition font-medium"
          >Admin</NuxtLink>
        </div>
      </nav>
    </header>

    <!-- Main Content -->
    <main class="flex-grow container mx-auto px-4 py-6 sm:py-8">
      <slot />
    </main>

    <footer class="bg-slate-950 border-t border-slate-800 text-slate-600 py-6 text-center text-sm">
      <p>&copy; 2026 HevyTracker · Tu analista de entrenamiento</p>
    </footer>

    <ToastHost />
  </div>
</template>

<script setup lang="ts">
const { session, clear } = useUserSession()
const isAdmin = computed(() => (session.value?.user as any)?.role === 'admin')
const toast = useToast()

const navLinks = [
  { to: '/', label: 'Dashboard' },
  { to: '/calendar', label: 'Calendario' },
  { to: '/mesocycles', label: 'Mesociclos' },
  { to: '/macrocycles', label: 'Macrociclos' },
  { to: '/progress', label: 'Progreso' },
  { to: '/volume', label: 'Volumen' },
  { to: '/body', label: 'Métricas' },
  { to: '/nutrition', label: 'Nutrición' },
  { to: '/chat', label: 'AI Coach' },
  { to: '/settings', label: 'Ajustes' }
]

const isSyncing = ref(false)
const syncStatus = ref('')
const userMenuOpen = ref(false)
const mobileNavOpen = ref(false)
const userMenuRef = ref<HTMLElement | null>(null)

const onDocumentClick = (e: MouseEvent) => {
  if (userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) {
    userMenuOpen.value = false
  }
}

onMounted(() => document.addEventListener('click', onDocumentClick))
// The old version registered this listener and never removed it, so every
// layout remount leaked another one.
onBeforeUnmount(() => document.removeEventListener('click', onDocumentClick))

const route = useRoute()
watch(() => route.fullPath, () => { mobileNavOpen.value = false })

/**
 * Starts the sync job and polls it.
 *
 * Nothing reloads the page any more: `refreshNuxtData()` re-runs the active
 * `useFetch` calls, which is the same refresh without losing scroll position or
 * re-downloading the app.
 */
const syncHevy = async () => {
  if (isSyncing.value) return
  isSyncing.value = true
  syncStatus.value = 'Iniciando…'

  try {
    const res = await $fetch<{ success: boolean; jobId: string | null; message: string }>('/api/sync', { method: 'POST' })

    if (!res.success || !res.jobId) {
      toast.error(res.message)
      return
    }

    const jobId = res.jobId
    while (true) {
      await new Promise(r => setTimeout(r, 1500))
      const job = await $fetch<{
        status: string; message: string | null; current: number; total: number
        error: string | null; finished: boolean
        result: { syncedWorkouts?: number; syncedMetrics?: number; newRecords?: number; alerts?: number } | null
      }>(`/api/sync/${jobId}`)

      syncStatus.value = job.total > 0
        ? `${job.message} ${job.current}/${job.total}`
        : (job.message ?? 'Sincronizando…')

      if (!job.finished) continue

      if (job.status === 'error') {
        toast.error(job.error ?? 'La sincronización falló.')
      } else {
        const r = job.result ?? {}
        const parts = [`${r.syncedWorkouts ?? 0} entrenos`, `${r.syncedMetrics ?? 0} medidas`]
        if (r.newRecords) parts.push(`${r.newRecords} récords 🎉`)
        toast.success(`Sincronización completada: ${parts.join(' · ')}`)
        if (r.alerts) toast.info(`${r.alerts} aviso(s) de entrenamiento pendientes de revisar.`)
        await refreshNuxtData()
      }
      break
    }
  } catch {
    toast.error('No se pudo conectar con el servidor para sincronizar.')
  } finally {
    isSyncing.value = false
    syncStatus.value = ''
  }
}

const handleLogout = async () => {
  userMenuOpen.value = false
  try {
    await $fetch('/auth/logout', { method: 'POST' })
  } catch {}
  await clear()
  await navigateTo('/login')
}
</script>
