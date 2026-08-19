<template>
  <UiCard eyebrow="Registro" title="Entrenos recientes" flush>
    <template #actions>
      <UiLink to="/calendar" class="text-xs">Ver calendario</UiLink>
    </template>

    <UiEmptyState
      v-if="workouts.length === 0"
      title="Todavía no hay entrenos"
      description="Sincroniza con Hevy para traer tu historial."
    />

    <ul v-else class="divide-y divide-line">
      <li v-for="workout in workouts" :key="workout.id">
        <NuxtLink
          :to="`/workouts/${workout.id}`"
          class="flex justify-between items-center gap-4 px-5 py-3.5 hover:bg-surface-2 transition"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-ink truncate">{{ workout.name }}</p>
            <p class="font-data text-xs text-ink-3 mt-0.5">
              {{ formatDate(workout.date) }}<span v-if="workout.duration"> · {{ formatDuration(workout.duration) }}</span>
            </p>
          </div>
          <p v-if="workout.total_volume" class="font-data text-sm text-ink-2 flex-shrink-0">
            {{ workout.total_volume.toLocaleString('es-ES') }} kg
          </p>
        </NuxtLink>
      </li>
    </ul>
  </UiCard>
</template>

<script setup lang="ts">
import type { Workout } from '@prisma/client'

/**
 * The whole row is the link, rather than a "ver detalle" link sitting next to
 * the name: on a phone the row is the touch target you actually hit.
 *
 * The copy and the dates were in English here — "Recent Workouts", "View
 * details", `en-US` — in an app that is otherwise entirely in Spanish.
 */
defineProps<{
  workouts: Partial<Workout>[]
}>()

const formatDate = (date: any) => {
  if (!date) return ''
  return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(date))
}

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}
</script>
