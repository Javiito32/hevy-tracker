<template>
  <section v-if="visible.length" class="mb-6">
    <div class="flex items-end justify-between gap-3 mb-3">
      <div>
        <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-1">Detectado</p>
        <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Avisos de entrenamiento</h2>
      </div>
      <div class="flex items-center gap-3">
        <UiLink to="/volume" class="text-xs">Ver volumen</UiLink>
        <UiLink :to="{ path: '/chat', query: { context: 'alerts' } }" class="text-xs">Preguntar al coach</UiLink>
      </div>
    </div>

    <ul class="space-y-2">
      <li
        v-for="alert in visible"
        :key="alert.id"
        class="bg-surface border rounded-card px-4 py-3.5 flex items-start gap-3"
        :class="styleFor(alert.severity).container"
      >
        <!-- Glyph, written severity and colour. The three glyphs are different
             shapes, not three coloured dots: a red circle and an orange circle
             are the same mark twice for a reader who cannot separate the hues. -->
        <span class="text-sm leading-5 flex-shrink-0" :class="styleFor(alert.severity).text" aria-hidden="true">
          {{ styleFor(alert.severity).glyph }}
        </span>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <p class="text-sm font-medium text-ink">{{ alert.title }}</p>
            <span
              class="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
              :class="styleFor(alert.severity).badge"
            >{{ styleFor(alert.severity).label }}</span>
            <span v-if="alert.days_open >= 7" class="font-data text-[10px] text-ink-3">
              hace {{ alert.days_open }} días
            </span>
          </div>
          <p class="text-xs text-ink-2 mt-1 leading-relaxed">{{ alert.detail }}</p>

          <!-- Every alert can be audited. A verdict the athlete cannot check
               gets either over-trusted or ignored. -->
          <button
            v-if="alert.evidence"
            class="text-[11px] text-ink-3 hover:text-ink mt-2 transition"
            @click="toggle(alert.id)"
          >
            {{ expanded.has(alert.id) ? '▾ Ocultar los datos' : '▸ Ver los datos' }}
          </button>
          <dl v-if="expanded.has(alert.id) && alert.evidence" class="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
            <div v-for="(value, key) in alert.evidence" :key="key" class="min-w-0">
              <dt class="text-[10px] text-ink-3 uppercase tracking-wide truncate">{{ key }}</dt>
              <dd class="font-data text-xs text-ink-2 truncate">{{ formatEvidence(value) }}</dd>
            </div>
          </dl>
        </div>

        <button
          :disabled="dismissing === alert.id"
          class="text-ink-3 hover:text-ink text-lg leading-none flex-shrink-0 disabled:opacity-40 transition"
          title="Descartar aviso"
          aria-label="Descartar aviso"
          @click="dismiss(alert.id)"
        >×</button>
      </li>
    </ul>
  </section>
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
    glyph: '⚠', label: 'Crítico',
    container: 'border-danger/40', text: 'text-danger',
    badge: 'bg-danger/10 text-danger'
  },
  warning: {
    glyph: '△', label: 'Atención',
    container: 'border-warn/40', text: 'text-warn',
    badge: 'bg-warn/10 text-warn'
  },
  info: {
    glyph: 'ℹ', label: 'Informativo',
    container: 'border-line', text: 'text-ink-3',
    badge: 'bg-surface-2 text-ink-2'
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
