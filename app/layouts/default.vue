<template>
  <div class="min-h-screen bg-bg flex flex-col">
    <header class="bg-bg/90 backdrop-blur-md border-b border-line sticky top-0 z-40">
      <div class="container mx-auto px-4 h-14 flex justify-between items-center gap-3">
        <NuxtLink to="/" class="flex items-center gap-2.5 flex-shrink-0 group" aria-label="HevyTracker, inicio">
          <!-- The mark is a rule with graduations of unequal length: this app
               is an instrument, and the same device recurs wherever a value is
               measured against a threshold. -->
          <svg class="w-5 h-5 text-ink" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M2 5h20" stroke-width="2" stroke-linecap="round" />
            <path d="M6.5 5v4M11 5v7M15.5 5v4M20 5v10" stroke-width="1.75" stroke-linecap="round" />
          </svg>
          <span class="font-display text-sm font-semibold tracking-eyebrow hidden sm:inline">
            <span class="text-ink">HEVY</span><span class="text-ink-3">TRACKER</span>
          </span>
        </NuxtLink>

        <nav class="hidden lg:flex items-center gap-1 text-sm">
          <NuxtLink
            v-for="link in allLinks"
            :key="link.to"
            :to="link.to"
            class="relative px-2.5 py-1.5 rounded transition-colors whitespace-nowrap"
            :class="isActive(link.to) ? 'text-ink' : 'text-ink-3 hover:text-ink'"
            :aria-current="isActive(link.to) ? 'page' : undefined"
          >
            {{ link.label }}
            <!-- Where you are was previously not marked at all: ten destinations
                 and no indication which one you were looking at. -->
            <span
              v-if="isActive(link.to)"
              class="absolute inset-x-2.5 -bottom-px h-px bg-ink"
              aria-hidden="true"
            />
          </NuxtLink>
        </nav>

        <div class="flex items-center gap-2 flex-shrink-0">
          <!-- Sync shows live progress rather than freezing behind an alert(). -->
          <button
            :disabled="isSyncing"
            :title="syncStatus || 'Sincronizar con Hevy'"
            class="inline-flex items-center gap-2 px-3 min-h-[36px] rounded-lg text-xs font-medium
                   bg-surface-2 border border-line-strong text-ink-2
                   hover:text-ink hover:border-ink-3 disabled:opacity-50 transition"
            @click="syncHevy"
          >
            <UiSpinner v-if="isSyncing" size="sm" />
            <svg v-else class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M20 9A8 8 0 006.3 5.3M4 15a8 8 0 0013.7 3.7" />
            </svg>
            <span class="hidden md:inline">{{ isSyncing ? (syncStatus || 'Sincronizando…') : 'Sincronizar' }}</span>
          </button>

          <div ref="userMenuRef" class="relative">
            <button
              class="flex items-center gap-2 px-2.5 min-h-[36px] rounded-lg text-xs
                     bg-surface-2 border border-line-strong text-ink-2 hover:text-ink hover:border-ink-3 transition"
              :aria-expanded="userMenuOpen"
              aria-haspopup="true"
              @click="userMenuOpen = !userMenuOpen"
            >
              <span class="font-medium hidden sm:inline max-w-[8rem] truncate">{{ session?.user?.name ?? 'Usuario' }}</span>
              <svg class="w-3.5 h-3.5 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span v-if="isAdmin" class="font-data text-[10px] text-ink-3 hidden sm:inline">ADM</span>
              <svg class="w-3.5 h-3.5 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <div
              v-if="userMenuOpen"
              class="absolute right-0 mt-2 w-56 bg-surface border border-line-strong rounded-card z-50 overflow-hidden"
            >
              <div class="px-3 py-2.5 border-b border-line">
                <p class="text-sm font-medium text-ink truncate">{{ session?.user?.name }}</p>
                <p class="text-xs text-ink-3 truncate">{{ session?.user?.email }}</p>
              </div>

              <div class="px-3 py-3 border-b border-line">
                <UiThemeToggle />
              </div>

              <nav class="py-1 text-sm">
                <NuxtLink
                  to="/settings"
                  class="block px-3 py-2 text-ink-2 hover:text-ink hover:bg-surface-2 transition"
                  @click="userMenuOpen = false"
                >Ajustes</NuxtLink>
                <NuxtLink
                  v-if="isAdmin"
                  to="/admin"
                  class="block px-3 py-2 text-ink-2 hover:text-ink hover:bg-surface-2 transition"
                  @click="userMenuOpen = false"
                >Panel de administración</NuxtLink>
                <button
                  class="w-full text-left px-3 py-2 text-danger hover:bg-danger/10 transition"
                  @click="handleLogout"
                >Cerrar sesión</button>
              </nav>
            </div>
          </div>

          <!-- The nav has ten destinations and this app is used in a gym, on a
               phone. Below lg they live behind this. -->
          <button
            class="lg:hidden bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg w-9 h-9 flex items-center justify-center
                   text-ink-2 hover:text-ink transition"
            :aria-expanded="mobileNavOpen"
            aria-label="Abrir menú de navegación"
            @click="mobileNavOpen = !mobileNavOpen"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
              <path v-if="!mobileNavOpen" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M4 12h16M4 17h16" />
              <path v-else stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <nav v-if="mobileNavOpen" class="lg:hidden border-t border-line bg-bg">
        <div class="container mx-auto px-4 py-2 grid grid-cols-2 sm:grid-cols-3 gap-1">
          <NuxtLink
            v-for="link in allLinks"
            :key="link.to"
            :to="link.to"
            class="px-3 py-3 rounded-lg text-sm transition"
            :class="isActive(link.to) ? 'bg-surface-2 text-ink font-medium' : 'text-ink-2 hover:bg-surface-2'"
            :aria-current="isActive(link.to) ? 'page' : undefined"
            @click="mobileNavOpen = false"
          >{{ link.label }}</NuxtLink>
        </div>
      </nav>
    </header>

    <main class="flex-grow container mx-auto px-4 py-7 sm:py-9">
      <slot />
    </main>

    <footer class="border-t border-line py-6">
      <div class="container mx-auto px-4 flex items-center justify-between gap-4 text-xs text-ink-3 flex-wrap">
        <p>HevyTracker — tu analista de entrenamiento</p>
        <p class="font-data">&copy; 2026</p>
      </div>
    </footer>

    <ToastHost />
  </div>
</template>

<script setup lang="ts">
const { session, clear } = useUserSession()
const isAdmin = computed(() => (session.value?.user as any)?.role === 'admin')
const toast = useToast()
const route = useRoute()

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

const allLinks = computed(() =>
  isAdmin.value ? [...navLinks, { to: '/admin', label: 'Admin' }] : navLinks
)

/** '/' only matches itself — prefix matching would light up every route. */
const isActive = (to: string) =>
  to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`)

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

watch(() => route.fullPath, () => {
  mobileNavOpen.value = false
  userMenuOpen.value = false
})

/**
 * Starts the sync job and polls it.
 *
 * Nothing reloads the page: `refreshNuxtData()` re-runs the active `useFetch`
 * calls, which is the same refresh without losing scroll position or
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
