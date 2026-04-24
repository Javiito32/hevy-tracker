<template>
  <div class="bg-white rounded-lg shadow overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
      <h2 class="text-lg font-semibold text-gray-800">
        {{ monthName }} {{ year }}
      </h2>
      <div class="flex space-x-2">
        <button @click="previousMonth" class="p-2 rounded-full hover:bg-gray-100 text-gray-600 transition">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
        </button>
        <button @click="nextMonth" class="p-2 rounded-full hover:bg-gray-100 text-gray-600 transition">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
        </button>
      </div>
    </div>

    <!-- Days of week -->
    <div class="grid grid-cols-7 gap-px bg-gray-200 border-b border-gray-200">
      <div v-for="day in ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']" :key="day" class="bg-gray-50 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
        {{ day }}
      </div>
    </div>

    <!-- Calendar Grid -->
    <div class="grid grid-cols-7 gap-px bg-gray-200">
      <div 
        v-for="(day, index) in calendarDays" 
        :key="index"
        @click="selectDay(day)"
        class="min-h-[100px] bg-white p-2 transition cursor-pointer hover:bg-blue-50"
        :class="{
          'text-gray-400 bg-gray-50': !day.isCurrentMonth,
          'bg-blue-50 ring-2 ring-inset ring-blue-500': isSelected(day.date),
        }"
      >
        <div class="flex justify-between items-start">
          <span 
            class="text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full"
            :class="{ 'bg-blue-600 text-white': isToday(day.date) }"
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
import { computed, ref } from 'vue'

const props = defineProps<{
  workouts: any[]
  selectedDate: Date | null
}>()

const emit = defineEmits(['select-date'])

const currentDate = ref(new Date())

const monthName = computed(() => currentDate.value.toLocaleString('default', { month: 'long' }))
const year = computed(() => currentDate.value.getFullYear())

const getIntensityClass = (intensity: string) => {
  switch(intensity) {
    case 'high': return 'bg-purple-600'
    case 'medium': return 'bg-blue-500'
    case 'low': return 'bg-green-500'
    default: return 'bg-gray-500'
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
  
  // Previous month overflow
  const firstDayWeekday = firstDayOfMonth.getDay()
  for (let i = firstDayWeekday - 1; i >= 0; i--) {
    const prevDate = new Date(year, month, -i)
    days.push(createDayObject(prevDate, false))
  }
  
  // Current month days
  for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
    const currDate = new Date(year, month, i)
    days.push(createDayObject(currDate, true))
  }
  
  // Next month overflow
  const totalDays = days.length
  const remainingCells = 42 - totalDays // 6 rows of 7 days
  for (let i = 1; i <= remainingCells; i++) {
    const nextDate = new Date(year, month + 1, i)
    days.push(createDayObject(nextDate, false))
  }
  
  return days
})

const createDayObject = (date: Date, isCurrentMonth: boolean) => {
  // Find workouts for this day
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
