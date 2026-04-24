<template>
  <div class="bg-white rounded-lg shadow p-6 border border-gray-200 hover:shadow-md transition">
    <div class="flex justify-between items-start mb-4">
      <div>
        <h3 class="text-xl font-semibold text-gray-900">{{ mesocycle.name }}</h3>
        <p class="text-sm text-gray-500 mt-1">{{ formatDate(mesocycle.start_date) }} - {{ formatDate(mesocycle.end_date) || 'Ongoing' }}</p>
      </div>
      <span :class="['px-2 py-1 text-xs rounded-full font-medium flex items-center', statusClass]">
        <span class="w-2 h-2 rounded-full mr-1.5" :class="statusDotClass"></span>
        {{ formatStatus(mesocycle.status) }}
      </span>
    </div>
    
    <div class="mb-4">
      <p class="text-gray-700 text-sm line-clamp-2" :title="mesocycle.goal">{{ mesocycle.goal || 'No specific goal set.' }}</p>
    </div>
    
    <div class="pt-4 border-t border-gray-100 flex justify-between items-center">
      <div class="text-sm text-gray-600">
        <span class="font-medium text-gray-900">{{ workoutCount }}</span> workouts
      </div>
      <NuxtLink :to="`/mesocycles/${mesocycle.id}`" class="text-blue-600 hover:text-blue-800 text-sm font-medium">View Plan →</NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Mesocycle } from '@prisma/client'

const props = defineProps<{
  mesocycle: Partial<Mesocycle>
  workoutCount: number
}>()

const formatDate = (dateValue: any) => {
  if (!dateValue) return ''
  const date = new Date(dateValue)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

const formatStatus = (status: string | undefined) => {
  if (!status) return 'Unknown'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

const statusClass = computed(() => {
  switch (props.mesocycle.status) {
    case 'active': return 'bg-green-100 text-green-800'
    case 'completed': return 'bg-blue-100 text-blue-800'
    case 'paused': return 'bg-yellow-100 text-yellow-800'
    default: return 'bg-gray-100 text-gray-800'
  }
})

const statusDotClass = computed(() => {
  switch (props.mesocycle.status) {
    case 'active': return 'bg-green-500'
    case 'completed': return 'bg-blue-500'
    case 'paused': return 'bg-yellow-500'
    default: return 'bg-gray-500'
  }
})
</script>
