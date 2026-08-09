<template>
  <UiCard
    eyebrow="Mantenimiento"
    title="Trabajos recientes"
    hint="Últimas 25 operaciones, la más reciente primero. Se actualiza solo mientras algo está en curso."
    flush
  >
    <template #actions>
      <span v-if="anyRunning" class="text-xs text-ink-2 flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-ink-2 animate-pulse"></span>
        en curso
      </span>
    </template>

    <UiEmptyState
      v-if="!jobs.length"
      title="Sin trabajos registrados"
      description="Las operaciones lanzadas desde la pestaña «Mantenimiento» aparecerán aquí con su progreso y su resultado."
    />

    <div v-else class="p-5 space-y-2">
      <div
        v-for="job in jobs"
        :key="job.id"
        class="bg-surface-2/40 border border-line rounded-lg px-4 py-3"
      >
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="w-2 h-2 rounded-full flex-shrink-0"
              :class="{
                'bg-ink-2 animate-pulse': job.status === 'running' || job.status === 'pending',
                'bg-positive': job.status === 'done',
                'bg-danger': job.status === 'error'
              }"
            ></span>
            <span class="text-sm text-ink-2 truncate">{{ job.label }}</span>
            <span v-if="job.user_name" class="text-xs text-ink-3 truncate">· {{ job.user_name }}</span>
          </div>
          <span class="text-xs text-ink-3 font-data">{{ formatDateTime(job.created_at) }}</span>
        </div>

        <!-- Determinate bar only when a total is known; otherwise the label
             carries the state rather than a bar that fakes a percentage. -->
        <div v-if="job.status === 'running'" class="mt-2">
          <p class="text-xs text-ink-3 mb-1">
            {{ job.message }}
            <span v-if="job.progress_total > 0" class="font-data">
              ({{ job.progress_current }}/{{ job.progress_total }})
            </span>
          </p>
          <div v-if="job.progress_total > 0" class="w-full bg-surface-2 rounded-full h-1">
            <div
              class="bg-accent h-1 rounded-full transition-all"
              :style="{ width: Math.min(100, (job.progress_current / job.progress_total) * 100) + '%' }"
            ></div>
          </div>
        </div>

        <p v-else-if="job.status === 'done' && job.result" class="text-xs text-positive/80 mt-1.5 font-data">
          {{ describeJobResult(job.result) }}
        </p>
        <p v-else-if="job.status === 'error'" class="text-xs text-danger mt-1.5">{{ job.error }}</p>
      </div>
    </div>
  </UiCard>
</template>

<script setup lang="ts">
/**
 * The job history, split out of `MaintenanceCard` when the panel grew tabs.
 * State comes from `useMaintenanceJobs`, so this view and the operations view
 * read the same list and one poller serves both.
 */
const { jobs, anyRunning, loadJobs, startPolling } = useMaintenanceJobs()

onMounted(async () => {
  await loadJobs()
  if (anyRunning.value) startPolling()
})
</script>
