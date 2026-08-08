<template>
  <div>
    <h1 class="text-3xl font-bold mb-6 text-slate-100">Dashboard</h1>

    <div v-if="pending" class="text-center py-10">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent mx-auto"></div>
    </div>

    <div v-else-if="error" class="bg-rose-950/60 border border-rose-800 text-rose-400 text-sm px-4 py-3 rounded-lg">
      No se pudo cargar el panel. Reintenta en unos segundos.
    </div>

    <template v-else-if="data">
      <!-- Detected problems come before the summary tiles: what needs attention
           should not sit below what is merely informative. -->
      <DashboardTrainingAlerts />

      <!-- Top metric cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <!-- Active Mesocycle -->
        <DashboardMetricCard title="Mesociclo Activo" color="blue">
          <template v-if="data.activeMesocycle">
            <p class="font-medium text-slate-100">{{ data.activeMesocycle.name }}</p>
            <p class="text-sm text-slate-500 mb-3 line-clamp-2">{{ data.activeMesocycle.goal }}</p>
            <div class="flex justify-between items-center text-sm flex-wrap gap-2">
              <div class="flex gap-2">
                <span class="bg-indigo-950/60 text-indigo-400 py-0.5 px-2 rounded text-xs">Semana {{ data.currentWeek }}</span>
                <span v-if="data.daysRemaining !== null" class="bg-slate-800 text-slate-400 py-0.5 px-2 rounded text-xs">
                  {{ data.daysRemaining }}d restantes
                </span>
              </div>
              <NuxtLink :to="`/mesocycles/${data.activeMesocycle.id}`" class="text-indigo-400 hover:text-indigo-300 text-xs transition">Ver detalle</NuxtLink>
            </div>
          </template>
          <template v-else>
            <p class="text-slate-500 mb-4">Sin mesociclo activo.</p>
            <NuxtLink to="/mesocycles/new" class="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 text-sm transition">Crear uno</NuxtLink>
          </template>
        </DashboardMetricCard>

        <!-- Weight -->
        <DashboardMetricCard title="Peso Actual" color="green">
          <template v-if="data.weight?.current">
            <div class="flex items-end mb-3">
              <span class="text-3xl font-bold text-slate-100">{{ data.weight.current }}</span>
              <span class="text-slate-500 ml-1 mb-1">kg</span>
              <span v-if="data.weight.diff !== 0" class="ml-3 text-sm flex items-center" :class="data.weight.diff > 0 ? 'text-rose-400' : 'text-emerald-400'">
                {{ data.weight.diff > 0 ? '▲' : '▼' }} {{ Math.abs(data.weight.diff) }}kg
              </span>
            </div>
            <p class="text-xs text-slate-500">Actualizado: {{ new Date(data.weight.lastUpdated).toLocaleDateString('es-ES') }}</p>
          </template>
          <template v-else>
            <p class="text-slate-500">Sin datos de peso.</p>
          </template>
        </DashboardMetricCard>

        <!-- This week -->
        <DashboardMetricCard title="Esta Semana" color="purple">
          <div class="flex items-end mb-3">
            <span class="text-3xl font-bold text-slate-100">{{ data.thisWeekWorkouts.completed }}</span>
            <span class="text-slate-500 ml-1 mb-1">/ {{ data.thisWeekWorkouts.target }} entrenos</span>
          </div>
          <div class="w-full bg-slate-800 rounded-full h-1.5">
            <div
              class="bg-violet-500 h-1.5 rounded-full transition-all"
              :style="{ width: Math.min(100, (data.thisWeekWorkouts.completed / data.thisWeekWorkouts.target) * 100) + '%' }"
            ></div>
          </div>
          <p class="text-xs text-slate-500 mt-2">
            {{ data.thisWeekWorkouts.completed >= data.thisWeekWorkouts.target ? '✅ Objetivo cumplido' : `Faltan ${data.thisWeekWorkouts.target - data.thisWeekWorkouts.completed}` }}
          </p>
        </DashboardMetricCard>
      </div>

      <!-- Mesocycle volume progress -->
      <div v-if="data.mesocycleWeeklyVolume?.length" class="bg-slate-900 rounded-xl border border-slate-800 p-6 mb-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-base font-semibold text-slate-200">Volumen por semana del mesociclo</h2>
          <span class="text-xs text-slate-500">{{ data.mesocycleWeeklyVolume.length }} semanas</span>
        </div>
        <!-- Values are printed above every bar rather than revealed on hover:
             a hover-only label is unreachable on the phone this app is used on. -->
        <div class="flex items-end gap-2 h-32">
          <div
            v-for="week in data.mesocycleWeeklyVolume"
            :key="week.week"
            class="flex-1 flex flex-col justify-end items-center"
            :title="`Semana ${week.week}: ${week.volume.toLocaleString('es-ES')} kg · ${week.workoutCount} sesiones${week.avgRpe ? ` · RPE ${week.avgRpe}` : ''}`"
          >
            <span class="text-[10px] font-medium text-slate-400 tabular-nums mb-1 whitespace-nowrap">
              {{ (week.volume / 1000).toFixed(1) }}t
            </span>
            <div
              class="w-full rounded-t-[4px] transition-all"
              :class="week.week === data.currentWeek ? 'bg-indigo-500' : 'bg-indigo-900'"
              :style="{ height: `${Math.max(2, (week.volume / maxWeekVolume) * 90)}px` }"
            ></div>
            <span class="text-[10px] mt-1 text-slate-600">S{{ week.week }}</span>
          </div>
        </div>
        <div class="flex items-center gap-4 mt-3 text-xs text-slate-500">
          <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-indigo-500 inline-block"></span> Semana actual</span>
          <span class="flex items-center gap-1"><span class="w-3 h-3 rounded bg-indigo-900 inline-block"></span> Semanas anteriores</span>
          <span class="ml-auto">Volumen de trabajo, sin calentamiento</span>
        </div>
      </div>

      <!-- Recent workouts + weight chart -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div class="lg:col-span-2">
          <DashboardRecentWorkouts :workouts="data.recentWorkouts" @sync="refresh" />
        </div>
        <div class="bg-slate-900 rounded-xl border border-slate-800 lg:col-span-1">
          <DashboardWeightChart />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const { data, pending, error, refresh } = useFetch('/api/dashboard')

const maxWeekVolume = computed(() => {
  if (!data.value?.mesocycleWeeklyVolume?.length) return 1
  return Math.max(...data.value.mesocycleWeeklyVolume.map((w: any) => w.volume), 1)
})
</script>
