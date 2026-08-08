<template>
  <div class="h-full flex flex-col">
    <UiPageHeader title="Calendario">
      <template #actions>
        <span class="font-data text-xs text-ink-3 bg-surface border border-line rounded-lg px-3 py-2">
          {{ realWorkouts?.length ?? 0 }} entrenos en el periodo
        </span>
      </template>
    </UiPageHeader>

    <p v-if="error" class="text-sm text-danger flex items-start gap-2 bg-danger/5 border border-danger/30 rounded-lg px-4 py-3 mb-4">
      <span aria-hidden="true">⚠</span>No se pudieron cargar los entrenamientos. Reintenta o revisa la conexión.
    </p>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-grow">
      <div class="lg:col-span-2 relative">
        <div v-if="pending" class="absolute inset-0 bg-bg/70 flex items-center justify-center z-10 rounded-card text-ink-3">
          <UiSpinner size="lg" />
        </div>

        <CalendarGrid
          :workouts="realWorkouts || []"
          :selected-date="selectedDate"
          @select-date="handleSelectDate"
          @month-change="handleMonthChange"
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

// The grid drives this: /api/workouts is range-scoped, so the page fetches the
// window the calendar is actually showing rather than the whole history.
const range = ref<{ from: string; to: string }>(defaultRange())

function defaultRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  from.setDate(from.getDate() - 7)
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  to.setDate(to.getDate() + 7)
  return { from: from.toISOString(), to: to.toISOString() }
}

const { data: realWorkouts, pending, error } = useFetch('/api/workouts', {
  query: range,
  watch: [range]
})

const handleMonthChange = (r: { from: Date; to: Date }) => {
  range.value = { from: r.from.toISOString(), to: r.to.toISOString() }
}

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
