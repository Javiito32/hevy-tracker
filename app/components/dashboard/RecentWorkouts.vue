<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 mb-8">
    <div class="px-6 py-4 border-b border-slate-800 flex justify-between items-center">
      <h2 class="text-lg font-semibold text-slate-100">Recent Workouts</h2>
      <button @click="$emit('sync')" class="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition">Sync with Hevy</button>
    </div>
    <div class="divide-y divide-slate-800">
      <div v-if="workouts.length === 0" class="p-6 text-center text-slate-500">
        No recent workouts found.
      </div>
      <div v-for="workout in workouts" :key="workout.id" class="p-6 hover:bg-slate-800/50 transition">
        <div class="flex justify-between items-center">
          <div>
            <h3 class="text-base font-medium text-slate-100">{{ workout.name }}</h3>
            <p class="text-sm text-slate-500">{{ formatDate(workout.date) }} <span v-if="workout.duration">• {{ formatDuration(workout.duration) }}</span></p>
          </div>
          <div class="text-right">
            <p v-if="workout.total_volume" class="text-sm font-medium text-slate-300">Volume: {{ workout.total_volume.toLocaleString() }} kg</p>
            <NuxtLink :to="`/workouts/${workout.id}`" class="text-indigo-400 hover:text-indigo-300 text-sm mt-1 block transition">View details</NuxtLink>
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
