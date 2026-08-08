<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden">
    <div class="flex items-center justify-between px-5 py-3.5 border-b border-line">
      <h2 class="font-display text-sm font-semibold tracking-tight text-ink capitalize">
        {{ monthName }} {{ year }}
      </h2>
      <div class="flex gap-1">
        <button
          class="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-surface-2 text-ink-3 hover:text-ink transition"
          aria-label="Mes anterior"
          @click="previousMonth"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
        <button
          class="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-surface-2 text-ink-3 hover:text-ink transition"
          aria-label="Mes siguiente"
          @click="nextMonth"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>

    <div class="grid grid-cols-7 gap-px bg-line border-b border-line">
      <div
        v-for="day in WEEKDAYS"
        :key="day"
        class="bg-surface py-2 text-center font-data text-[10px] font-medium text-ink-3 uppercase tracking-wide"
      >{{ day }}</div>
    </div>

    <div class="grid grid-cols-7 gap-px bg-line">
      <div
        v-for="(day, index) in calendarDays"
        :key="index"
        class="min-h-[100px] bg-surface p-2 transition cursor-pointer hover:bg-surface-2"
        :class="[
          !day.isCurrentMonth && 'opacity-45',
          isSelected(day.date) && 'ring-1 ring-inset ring-ink bg-surface-2'
        ]"
        @click="selectDay(day)"
      >
        <!-- Today is marked by the contrast inversion, the same device as the
             primary button: it is the one cell the eye should land on. -->
        <span
          class="font-data text-xs w-6 h-6 flex items-center justify-center rounded"
          :class="isToday(day.date) ? 'bg-accent text-accent-ink font-semibold' : 'text-ink-3'"
        >{{ day.date.getDate() }}</span>

        <div v-if="day.workouts && day.workouts.length > 0" class="mt-1.5 space-y-1">
          <!-- Intensity is an ordered variable, so it is encoded as a ramp of
               one ink rather than three unrelated hues: low/medium/high are
               steps on a scale, and three colours implied three categories. -->
          <div
            v-for="workout in day.workouts"
            :key="workout.id"
            class="text-[11px] px-1.5 py-1 rounded truncate"
            :class="intensityClass(workout.intensity)"
            :title="`${workout.name} · intensidad ${intensityLabel(workout.intensity)}`"
          >{{ workout.name }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  workouts: any[]
  selectedDate: Date | null
}>()

const emit = defineEmits<{
  'select-date': [date: Date]
  /**
   * The visible month changed. The parent owns fetching, and /api/workouts is
   * range-scoped now, so without this the grid would silently show an empty
   * month as soon as the user navigated outside the fetched window.
   */
  'month-change': [range: { from: Date; to: Date }]
}>()

const currentDate = ref(new Date())

const monthName = computed(() => currentDate.value.toLocaleDateString('es-ES', { month: 'long' }))
const year = computed(() => currentDate.value.getFullYear())

/** Padded a week either side, because the grid shows trailing days of the adjacent months. */
const visibleRange = computed(() => {
  const y = currentDate.value.getFullYear()
  const m = currentDate.value.getMonth()
  const from = new Date(y, m, 1)
  from.setDate(from.getDate() - 7)
  const to = new Date(y, m + 1, 0)
  to.setDate(to.getDate() + 7)
  to.setHours(23, 59, 59, 999)
  return { from, to }
})

watch(visibleRange, (range) => emit('month-change', range), { immediate: true })

/**
 * Monday first. The grid was hardcoded to a Sunday start with English headers
 * ('Sun'…'Sat') in an app that is otherwise entirely `es-ES` — so every date in
 * it sat in the wrong column for the person reading it.
 */
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** `getDay()` is 0-Sunday; this shifts it to 0-Monday. */
const mondayIndex = (date: Date) => (date.getDay() + 6) % 7

const INTENSITY = {
  low: { class: 'bg-ink-3/20 text-ink-2', label: 'baja' },
  medium: { class: 'bg-ink-3/50 text-ink', label: 'media' },
  high: { class: 'bg-ink text-bg font-medium', label: 'alta' }
} as const

const intensityOf = (i: string) => INTENSITY[i as keyof typeof INTENSITY] ?? INTENSITY.low
const intensityClass = (i: string) => intensityOf(i).class
const intensityLabel = (i: string) => intensityOf(i).label

const previousMonth = () => {
  currentDate.value = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() - 1, 1)
}

const nextMonth = () => {
  currentDate.value = new Date(currentDate.value.getFullYear(), currentDate.value.getMonth() + 1, 1)
}

const isToday = (date: Date) => {
  const today = new Date()
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear()
}

const isSelected = (date: Date) => {
  if (!props.selectedDate) return false
  return date.getDate() === props.selectedDate.getDate() &&
         date.getMonth() === props.selectedDate.getMonth() &&
         date.getFullYear() === props.selectedDate.getFullYear()
}

const selectDay = (day: any) => {
  emit('select-date', day.date)
}

const calendarDays = computed(() => {
  const year = currentDate.value.getFullYear()
  const month = currentDate.value.getMonth()

  const firstDayOfMonth = new Date(year, month, 1)
  const lastDayOfMonth = new Date(year, month + 1, 0)

  const days = []

  const firstDayWeekday = mondayIndex(firstDayOfMonth)
  for (let i = firstDayWeekday - 1; i >= 0; i--) {
    const prevDate = new Date(year, month, -i)
    days.push(createDayObject(prevDate, false))
  }

  for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
    const currDate = new Date(year, month, i)
    days.push(createDayObject(currDate, true))
  }

  const totalDays = days.length
  const remainingCells = 42 - totalDays
  for (let i = 1; i <= remainingCells; i++) {
    const nextDate = new Date(year, month + 1, i)
    days.push(createDayObject(nextDate, false))
  }

  return days
})

const createDayObject = (date: Date, isCurrentMonth: boolean) => {
  const dayWorkouts = props.workouts.filter(w => {
    const wDate = new Date(w.date)
    return wDate.getDate() === date.getDate() &&
           wDate.getMonth() === date.getMonth() &&
           wDate.getFullYear() === date.getFullYear()
  })

  return {
    date,
    isCurrentMonth,
    workouts: dayWorkouts
  }
}
</script>
