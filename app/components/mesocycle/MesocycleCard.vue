<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 p-6 hover:border-slate-700 transition">
    <div class="flex justify-between items-start mb-4">
      <div>
        <h3 class="text-lg font-semibold text-slate-100">{{ mesocycle.name }}</h3>
        <p class="text-sm text-slate-500 mt-1">{{ formatDate(mesocycle.start_date) }} - {{ formatDate(mesocycle.end_date) || 'Ongoing' }}</p>
      </div>
      <span :class="['px-2 py-1 text-xs rounded-full font-medium flex items-center', statusClass]">
        <span class="w-2 h-2 rounded-full mr-1.5" :class="statusDotClass"></span>
        {{ formatStatus(mesocycle.status) }}
      </span>
    </div>

    <div class="mb-4">
      <p class="text-slate-400 text-sm line-clamp-2" :title="mesocycle.goal">{{ mesocycle.goal || 'No specific goal set.' }}</p>
    </div>

    <div class="pt-4 border-t border-slate-800 flex justify-between items-center">
      <div class="text-sm text-slate-500">
        <span class="font-medium text-slate-300">{{ workoutCount }}</span> workouts
      </div>
      <NuxtLink :to="`/mesocycles/${mesocycle.id}`" class="text-indigo-400 hover:text-indigo-300 text-sm font-medium transition">View Plan →</NuxtLink>
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
    case 'active': return 'bg-emerald-950/60 text-emerald-400'
    case 'completed': return 'bg-indigo-950/60 text-indigo-400'
    case 'paused': return 'bg-amber-950/60 text-amber-400'
    default: return 'bg-slate-800 text-slate-400'
  }
})

const statusDotClass = computed(() => {
  switch (props.mesocycle.status) {
    case 'active': return 'bg-emerald-500'
    case 'completed': return 'bg-indigo-500'
    case 'paused': return 'bg-amber-500'
    default: return 'bg-slate-500'
  }
})
</script>
