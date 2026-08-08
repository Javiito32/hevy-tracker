<template>
  <div class="h-full flex flex-col">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-3xl font-bold text-slate-100">Calendario</h1>
      <div class="flex items-center gap-2 text-sm text-slate-500 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2">
        <span class="w-2.5 h-2.5 rounded-full bg-violet-500 block"></span>
        <span>{{ realWorkouts?.length ?? 0 }} entrenos en el periodo</span>
      </div>
    </div>

    <div v-if="error" class="bg-rose-950/60 border border-rose-800 text-rose-400 text-sm px-4 py-3 rounded-lg mb-4">
      No se pudieron cargar los entrenamientos. Reintenta o revisa la conexión.
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-grow">
      <div class="lg:col-span-2 relative">
        <div v-if="pending" class="absolute inset-0 bg-slate-900/70 flex items-center justify-center z-10 rounded-xl">
          <div class="animate-spin inline-block w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full"></div>
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
