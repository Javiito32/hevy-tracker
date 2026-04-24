<template>
  <div class="h-full flex flex-col">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-3xl font-bold text-gray-800">Calendar</h1>
      <div class="flex items-center space-x-2 text-sm text-gray-500 bg-white rounded-lg shadow px-4 py-2">
        <span class="w-3 h-3 rounded-full bg-purple-600 block"></span><span class="mr-3">Synced</span>
      </div>
    </div>
    
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-grow">
      <div class="lg:col-span-2 relative">
        <div v-if="pending" class="absolute inset-0 bg-white/70 flex items-center justify-center z-10 rounded-lg">
          <div class="animate-spin inline-block w-8 h-8 border-[3px] border-current border-t-transparent text-blue-600 rounded-full"></div>
        </div>
      
        <CalendarGrid 
          :workouts="realWorkouts || []"
          :selected-date="selectedDate"
          @select-date="handleSelectDate"
        />
      </div>
      
      <div class="lg:col-span-1 flex flex-col">
        <CalendarWorkoutDetail
          :date="selectedDate"
          :workout="selectedWorkout"
          @notes-saved="handleNotesSaved"
          class="sticky top-6 flex-grow"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const selectedDate = ref<Date | null>(new Date()) 

const { data: realWorkouts, pending } = useFetch('/api/workouts')

const selectedWorkout = computed(() => {
  if (!selectedDate.value || !realWorkouts.value) return null
  
  return realWorkouts.value.find((w: any) => {
    const wDate = new Date(w.start_time || w.date)
    return wDate.getDate() === selectedDate.value!.getDate() &&
           wDate.getMonth() === selectedDate.value!.getMonth() &&
           wDate.getFullYear() === selectedDate.value!.getFullYear()
  }) || null
})

const handleSelectDate = (date: Date) => {
  selectedDate.value = date
}

const handleNotesSaved = (workoutId: string, notes: string | null) => {
  const w = realWorkouts.value?.find((w: any) => w.id === workoutId)
  if (w) (w as any).notes = notes
}
</script>
