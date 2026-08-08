<template>
  <div v-if="visible.length" class="mb-8">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-base font-semibold text-slate-200">
        Avisos
        <span class="text-xs font-normal text-slate-500 ml-1">detectados automáticamente</span>
      </h2>
      <NuxtLink to="/volume" class="text-xs text-indigo-400 hover:text-indigo-300 transition">
        Ver volumen por músculo →
      </NuxtLink>
    </div>

    <div class="space-y-2">
      <div
        v-for="alert in visible"
        :key="alert.id"
        class="rounded-xl border overflow-hidden"
        :class="styleFor(alert.severity).container"
      >
        <div class="px-5 py-3.5 flex items-start gap-3">
          <!-- Glyph + written severity: the colour is never the only cue. -->
          <span class="text-base leading-6 flex-shrink-0" aria-hidden="true">{{ styleFor(alert.severity).glyph }}</span>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="text-sm font-medium text-slate-100">{{ alert.title }}</p>
              <span class="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded" :class="styleFor(alert.severity).badge">
                {{ styleFor(alert.severity).label }}
              </span>
              <span v-if="alert.days_open >= 7" class="text-[10px] text-slate-500">
                hace {{ alert.days_open }} días
              </span>
            </div>
            <p class="text-xs text-slate-400 mt-1 leading-relaxed">{{ alert.detail }}</p>

            <button
              v-if="alert.evidence"
              @click="toggle(alert.id)"
              class="text-[11px] text-slate-500 hover:text-slate-300 mt-1.5 transition"
            >
              {{ expanded.has(alert.id) ? '▾ Ocultar datos' : '▸ Ver los datos' }}
            </button>
            <dl v-if="expanded.has(alert.id) && alert.evidence" class="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
              <div v-for="(value, key) in alert.evidence" :key="key" class="min-w-0">
                <dt class="text-[10px] text-slate-600 uppercase tracking-wide truncate">{{ key }}</dt>
                <dd class="text-xs text-slate-400 font-mono truncate">{{ formatEvidence(value) }}</dd>
              </div>
            </dl>
          </div>

          <button
            @click="dismiss(alert.id)"
            :disabled="dismissing === alert.id"
            class="text-slate-600 hover:text-slate-300 text-lg leading-none flex-shrink-0 disabled:opacity-40 transition"
            title="Descartar aviso"
          >×</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

interface Alert {
  id: string
  type: string
  subject: string
  severity: string
  title: string
  detail: string
  evidence: Record<string, unknown> | null
  days_open: number
}

const { data: alerts, refresh } = useFetch<Alert[]>('/api/alerts')

const expanded = ref(new Set<string>())
const dismissing = ref<string | null>(null)
/** Hidden locally the moment the user dismisses, so the row goes away without waiting for a refetch. */
const hidden = ref(new Set<string>())

const visible = computed(() => (alerts.value ?? []).filter(a => !hidden.value.has(a.id)))

const STYLES = {
  critical: {
    glyph: '🔴', label: 'Crítico',
    container: 'bg-rose-950/30 border-rose-900/50',
    badge: 'bg-rose-950/70 text-rose-400'
  },
  warning: {
    glyph: '🟠', label: 'Atención',
    container: 'bg-amber-950/30 border-amber-900/50',
    badge: 'bg-amber-950/70 text-amber-400'
  },
  info: {
    glyph: '🔵', label: 'Informativo',
    container: 'bg-slate-900 border-slate-800',
    badge: 'bg-slate-800 text-slate-400'
  }
} as const

const styleFor = (severity: string) => STYLES[severity as keyof typeof STYLES] ?? STYLES.info

const toggle = (id: string) => {
  const next = new Set(expanded.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expanded.value = next
}

const formatEvidence = (v: unknown): string => {
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'number') return String(Math.round(v * 100) / 100)
  return String(v)
}

const dismiss = async (id: string) => {
  dismissing.value = id
  try {
    await $fetch(`/api/alerts/${id}`, { method: 'PATCH', body: { status: 'dismissed' } })
    hidden.value = new Set([...hidden.value, id])
    await refresh()
  } catch {
    // Leave it on screen: silently vanishing an alert that wasn't stored would
    // make the athlete think it was handled.
  } finally {
    dismissing.value = null
  }
}
</script>
