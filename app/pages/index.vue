<template>
  <div>
    <UiPageHeader title="Dashboard" />

    <div v-if="pending" class="flex justify-center py-16 text-ink-3">
      <UiSpinner size="lg" />
    </div>

    <UiCard v-else-if="error" padded>
      <p class="text-sm text-danger flex items-start gap-2">
        <span aria-hidden="true">⚠</span>No se pudo cargar el panel. Reintenta en unos segundos.
      </p>
    </UiCard>

    <template v-else-if="data">
      <!-- Detected problems come before the summary tiles: what needs attention
           should not sit below what is merely informative. -->
      <DashboardTrainingAlerts />

      <div v-if="data.nextSession?.has_plan" class="mb-6">
        <MesocycleNextSession :data="data.nextSession" @push="pushToHevy" />
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <UiCard eyebrow="Bloque" title="Mesociclo activo">
          <template v-if="data.activeMesocycle">
            <p class="text-sm font-medium text-ink">{{ data.activeMesocycle.name }}</p>
            <p class="text-xs text-ink-3 mt-1 line-clamp-2">{{ data.activeMesocycle.goal }}</p>
            <div class="flex justify-between items-center gap-2 flex-wrap mt-4">
              <div class="flex gap-1.5">
                <span class="font-data text-[11px] bg-surface-2 text-ink-2 py-0.5 px-2 rounded">
                  Semana {{ data.currentWeek }}
                </span>
                <span v-if="data.daysRemaining !== null" class="font-data text-[11px] bg-surface-2 text-ink-3 py-0.5 px-2 rounded">
                  {{ data.daysRemaining }} d restantes
                </span>
              </div>
              <UiLink :to="`/mesocycles/${data.activeMesocycle.id}`" class="text-xs">Ver detalle</UiLink>
            </div>
          </template>
          <template v-else>
            <p class="text-sm text-ink-3 mb-4">Sin mesociclo activo.</p>
            <UiButton to="/mesocycles/new" size="sm">Crear un mesociclo</UiButton>
          </template>
        </UiCard>

        <UiCard eyebrow="Composición" title="Peso actual">
          <UiStat
            v-if="data.weight?.current"
            :value="data.weight.current"
            unit="kg"
            :decimals="1"
            :delta="data.weight.diff"
            delta-unit=" kg"
            :polarity="weightPolarity"
            :hint="`Actualizado el ${formatDateShort(data.weight.lastUpdated)}`"
          />
          <p v-else class="text-sm text-ink-3">Sin datos de peso. Sincroniza para traerlos de Hevy.</p>
        </UiCard>

        <UiCard eyebrow="Adherencia" title="Esta semana">
          <UiTickScale
            v-if="weekTarget != null"
            :value="data.thisWeekWorkouts.completed"
            :max="Math.max(weekTarget, data.thisWeekWorkouts.completed, 1)"
            :step="1"
            :landmarks="[{ value: weekTarget, label: 'Objetivo semanal', short: 'Objetivo' }]"
            :verdict="weekVerdict"
            :caption="weekCaption"
            :unit="`/ ${weekTarget} entrenos`"
            aria-label="Entrenos completados esta semana"
          />
          <UiStat
            v-else
            :value="data.thisWeekWorkouts.completed"
            unit="entrenos"
            hint="Sin objetivo semanal en el bloque activo."
          />
        </UiCard>
      </div>

      <UiCard
        v-if="data.mesocycleWeeklyVolume?.length"
        eyebrow="Mesociclo"
        title="Volumen por semana"
        hint="Volumen de trabajo, sin series de calentamiento."
        class="mb-6"
      >
        <template #actions>
          <span class="font-data text-xs text-ink-3">{{ data.mesocycleWeeklyVolume.length }} semanas</span>
        </template>

        <!-- Values are printed above every bar rather than revealed on hover:
             a hover-only label is unreachable on the phone this app is used on. -->
        <div class="flex items-end gap-2 h-32">
          <div
            v-for="week in data.mesocycleWeeklyVolume"
            :key="week.week"
            class="flex-1 flex flex-col justify-end items-center"
            :title="`Semana ${week.week}: ${week.volume.toLocaleString('es-ES')} kg · ${week.workoutCount} sesiones${week.avgRpe ? ` · RPE ${week.avgRpe}` : ''}`"
          >
            <span class="font-data text-[10px] text-ink-3 mb-1 whitespace-nowrap">
              {{ (week.volume / 1000).toFixed(1) }}t
            </span>
            <!-- The current week is picked out by contrast, not by a hue: this
                 is a "you are here" marker, not a verdict on the week. -->
            <div
              class="w-full rounded-t-[3px] transition-all"
              :class="week.week === data.currentWeek ? 'bg-ink' : 'bg-ink-3/45'"
              :style="{ height: `${Math.max(2, (week.volume / maxWeekVolume) * 90)}px` }"
            />
            <span class="font-data text-[10px] mt-1.5 text-ink-3">S{{ week.week }}</span>
          </div>
        </div>

        <div class="flex items-center gap-4 mt-4 pt-3 border-t border-line text-[11px] text-ink-3">
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-ink inline-block" /> Semana actual</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-sm bg-ink-3/45 inline-block" /> Semanas anteriores</span>
        </div>
      </UiCard>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div class="lg:col-span-2">
          <DashboardRecentWorkouts :workouts="data.recentWorkouts" />
        </div>
        <DashboardWeightChart />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const { data, pending, error, refresh } = useFetch('/api/dashboard')
const toast = useToast()

const maxWeekVolume = computed(() => {
  if (!data.value?.mesocycleWeeklyVolume?.length) return 1
  return Math.max(...data.value.mesocycleWeeklyVolume.map((w: any) => w.volume), 1)
})

/**
 * Body weight has no universally good direction — it depends on the block's
 * goal — so the delta is shown without a verdict rather than being coloured
 * green for "down", which would be wrong during a bulk.
 */
const weightPolarity = 'neutral' as const

const weekTarget = computed(() => data.value?.thisWeekWorkouts?.target ?? null)

const weekVerdict = computed(() => {
  const w = data.value?.thisWeekWorkouts
  if (!w || w.target == null) return 'neutral' as const
  return w.completed >= w.target ? ('positive' as const) : ('neutral' as const)
})

const weekCaption = computed(() => {
  const w = data.value?.thisWeekWorkouts
  if (!w || w.target == null) return ''
  const missing = w.target - w.completed
  return missing <= 0 ? 'Objetivo cumplido' : `Faltan ${missing}`
})

const pushToHevy = async () => {
  const id = data.value?.activeMesocycle?.id
  if (!id) return
  const alreadyPushed = data.value?.nextSession?.has_plan
  const question = alreadyPushed
    ? '¿Actualizar en Hevy las rutinas de este mesociclo con las cargas de esta semana?'
    : '¿Crear en tu cuenta de Hevy una carpeta con las rutinas de este mesociclo?'
  if (!confirm(question)) return
  try {
    const res = await $fetch<{ message: string }>(`/api/mesocycles/${id}/push-to-hevy`, { method: 'POST' })
    toast.success(res.message)
    await refresh()
  } catch (err: any) {
    toast.error(err?.data?.message ?? 'No se pudieron enviar las rutinas a Hevy.')
  }
}
</script>
