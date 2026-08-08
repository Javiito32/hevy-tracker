<template>
  <div class="bg-surface rounded-card border border-line p-4 mb-6">
    <div class="flex flex-wrap items-center gap-3">
      <span class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3">Periodo</span>

      <div class="flex gap-1 bg-surface-2 rounded-lg p-1">
        <button v-for="p in PRESETS" :key="p.days ?? 'all'"
          @click="selectPreset(p.days)"
          :class="isActivePreset(p.days)
            ? 'bg-accent text-accent-ink'
            : 'text-ink-2 hover:text-ink'"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition">
          {{ p.label }}
        </button>
      </div>

      <div class="flex items-center gap-2 ml-auto">
        <input type="date" v-model="customFrom" @change="applyCustom"
          class="bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-ink" />
        <span class="text-ink-3 text-sm">→</span>
        <input type="date" v-model="customTo" @change="applyCustom"
          class="bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:border-ink" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Date-range selector for the AI analytics. Owns only the input widgets; the
 * selected range lives in the parent page (same split as CalendarGrid emitting
 * select-date up to calendar.vue).
 */
const props = defineProps<{ from: string | null; to: string | null }>()
const emit = defineEmits<{ change: [{ from: string | null; to: string | null }] }>()

const PRESETS = [
  { label: '7 días', days: 7 },
  { label: '30 días', days: 30 },
  { label: '90 días', days: 90 },
  { label: 'Todo', days: null }
] as const

const customFrom = ref(props.from ?? '')
const customTo = ref(props.to ?? '')

/** Which preset (if any) the current range corresponds to, for highlighting. */
const activeDays = ref<number | null>(30)

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10)

const selectPreset = (days: number | null) => {
  activeDays.value = days
  if (days === null) {
    customFrom.value = ''
    customTo.value = ''
    emit('change', { from: null, to: null })
    return
  }
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  customFrom.value = toIsoDate(from)
  customTo.value = toIsoDate(to)
  emit('change', { from: customFrom.value, to: customTo.value })
}

const isActivePreset = (days: number | null) => activeDays.value === days

const applyCustom = () => {
  // Typing dates by hand takes the range off the presets, so none stays lit.
  activeDays.value = -1
  emit('change', { from: customFrom.value || null, to: customTo.value || null })
}
</script>
