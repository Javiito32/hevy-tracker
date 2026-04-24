<template>
  <div class="bg-white rounded-lg shadow mb-8">
    <div class="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
      <h2 class="text-xl font-semibold text-gray-800">Recent Workouts</h2>
      <button @click="$emit('sync')" class="text-blue-600 hover:text-blue-800 text-sm font-medium">Sync with Hevy</button>
    </div>
    <div class="divide-y divide-gray-200">
      <div v-if="workouts.length === 0" class="p-6 text-center text-gray-500">
        No recent workouts found.
      </div>
      <div v-for="workout in workouts" :key="workout.id" class="p-6 hover:bg-gray-50 transition">
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-lg font-medium text-gray-900">{{ workout.name }}</h3>
            <p class="text-sm text-gray-500">{{ formatDate(workout.date) }} <span v-if="workout.duration">• {{ formatDuration(workout.duration) }}</span></p>
          </div>
          <div class="text-right">
            <p v-if="workout.total_volume" class="text-sm font-medium text-gray-900">Volume: {{ workout.total_volume.toLocaleString() }} kg</p>
            <NuxtLink :to="`/workouts/${workout.id}`" class="text-blue-600 hover:underline text-sm mt-1 block">View details</NuxtLink>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Workout } from '@prisma/client'

defineProps<{
  workouts: Partial<Workout>[]
}>()

defineEmits(['sync'])

const formatDate = (date: any) => {
  if (!date) return ''
  const d = new Date(date)
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(d)
}

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
</script>
