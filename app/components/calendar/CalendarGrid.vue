<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-slate-800">
      <h2 class="text-lg font-semibold text-slate-100 capitalize">
        {{ monthName }} {{ year }}
      </h2>
      <div class="flex space-x-2">
        <button @click="previousMonth" class="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
        </button>
        <button @click="nextMonth" class="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
        </button>
      </div>
    </div>

    <!-- Days of week -->
    <div class="grid grid-cols-7 gap-px bg-slate-800 border-b border-slate-800">
      <div v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day" class="bg-slate-900 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wider">
        {{ day }}
      </div>
    </div>

    <!-- Calendar Grid -->
    <div class="grid grid-cols-7 gap-px bg-slate-800">
      <div
        v-for="(day, index) in calendarDays"
        :key="index"
        @click="selectDay(day)"
        class="min-h-[100px] bg-slate-900 p-2 transition cursor-pointer hover:bg-slate-800/70"
        :class="{
          'opacity-40': !day.isCurrentMonth,
          'ring-2 ring-inset ring-indigo-500 bg-indigo-950/30': isSelected(day.date),
        }"
      >
        <div class="flex justify-between items-start">
          <span
            class="text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full text-slate-400"
            :class="{ 'bg-indigo-600 text-white': isToday(day.date) }"
          >
            {{ day.date.getDate() }}
          </span>
        </div>

        <!-- Workout Indicators -->
        <div v-if="day.workouts && day.workouts.length > 0" class="mt-2 space-y-1">
          <div
            v-for="workout in day.workouts"
            :key="workout.id"
            class="text-xs px-2 py-1 rounded truncate text-white"
            :class="getIntensityClass(workout.intensity)"
            :title="workout.name"
          >
            {{ workout.name }}
          </div>
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

const getIntensityClass = (intensity: string) => {
  switch(intensity) {
    case 'high': return 'bg-violet-600'
    case 'medium': return 'bg-indigo-500'
    case 'low': return 'bg-emerald-600'
    default: return 'bg-slate-600'
  }
}

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

  const firstDayWeekday = firstDayOfMonth.getDay()
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
