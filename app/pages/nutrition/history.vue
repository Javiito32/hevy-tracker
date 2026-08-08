<template>
  <div class="max-w-5xl mx-auto">
    <div class="flex flex-wrap gap-3 justify-between items-center mb-6">
      <div>
        <h1 class="text-3xl font-bold text-slate-100">Histórico de la dieta</h1>
        <p class="text-sm text-slate-500 mt-1">
          Cada versión publicada queda congelada con sus fechas: esto es lo que comías en cada momento.
        </p>
      </div>
      <NuxtLink
        to="/nutrition"
        class="bg-slate-800 border border-slate-700 text-slate-300 px-4 py-2 rounded-lg hover:bg-slate-700 transition text-sm font-medium"
      >
        ← Dieta actual
      </NuxtLink>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <div class="animate-spin w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent"></div>
    </div>

    <div v-else-if="!published.length" class="bg-slate-900 rounded-xl border border-slate-800 p-10 text-center text-slate-500">
      <p class="text-sm">Todavía no has publicado ninguna versión de la dieta.</p>
    </div>

    <div v-else class="space-y-6">
      <!-- Evolución -->
      <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        <div class="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-sm font-semibold text-slate-300">
            Evolución de {{ NUTRIENT_LABELS[metric].toLowerCase() }}
          </h2>
          <div class="flex gap-1">
            <button
              v-for="key in MACRO_KEYS"
              :key="key"
              @click="metric = key"
              class="px-2.5 py-1 text-xs rounded-lg transition flex items-center gap-1.5"
              :class="metric === key
                ? 'bg-slate-700 text-slate-100'
                : 'bg-slate-800 border border-slate-700 text-slate-400 hover:bg-slate-700'"
            >
              <span class="w-2 h-2 rounded-full" :style="{ background: METRIC_COLORS[key] }"></span>
              {{ NUTRIENT_SHORT_LABELS[key] }}
            </button>
          </div>
        </div>

        <div class="p-6">
          <ChartsLineChart
            v-if="chartPoints.length > 1"
            :points="chartPoints"
            :color="METRIC_COLORS[metric]"
            :format-y="formatY"
            :h="220"
          />
          <p v-else class="text-sm text-slate-500 text-center py-8">
            Hace falta más de una versión publicada para dibujar la evolución.
          </p>

          <!-- Vista de tabla: ningún valor debe ser accesible sólo pasando el ratón -->
          <div class="mt-4">
            <button
              @click="showTable = !showTable"
              class="text-xs text-slate-500 hover:text-slate-300 transition"
            >
              {{ showTable ? '▲ Ocultar tabla' : '▼ Ver como tabla' }}
            </button>
            <div v-if="showTable" class="mt-3 overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wider">
                    <th class="py-2 text-left">Versión</th>
                    <th class="py-2 text-left">Desde</th>
                    <th v-for="key in MACRO_KEYS" :key="key" class="py-2 text-right">
                      {{ NUTRIENT_SHORT_LABELS[key] }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="v in chronological" :key="v.id" class="border-b border-slate-800/50">
                    <td class="py-2 text-slate-400">v{{ v.version_number }}</td>
                    <td class="py-2 text-slate-400">{{ formatDateShort(v.start_date) }}</td>
                    <td v-for="key in MACRO_KEYS" :key="key" class="py-2 text-right text-slate-300">
                      {{ formatNutrientValue(totalFor(v, key), key) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <!-- Versiones -->
      <div class="space-y-3">
        <h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Versiones ({{ data.versions.length }})
        </h2>
        <NutritionDietVersionCard
          v-for="version in data.versions"
          :key="version.id"
          :version="version"
          :expanded="expanded.has(version.id)"
          @toggle="toggle(version.id)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const { data: plans } = useFetch<any>('/api/nutrition/plans')

const planId = computed(() => plans.value?.plan?.id)
const { data, pending } = useFetch<any>(() => `/api/nutrition/plans/${planId.value}/versions`, {
  immediate: false,
  watch: [planId]
})

const metric = ref<'kcal' | 'protein_g' | 'carbs_g' | 'fat_g'>('kcal')
const showTable = ref(false)
const expanded = ref(new Set<string>())

/** Drafts have no start_date and were never followed — they aren't history. */
const published = computed(() =>
  (data.value?.versions ?? []).filter((v: any) => v.status !== 'draft' && v.start_date)
)

const chronological = computed(() => [...published.value].reverse())

const COLUMN: Record<string, string> = {
  kcal: 'total_kcal',
  protein_g: 'total_protein_g',
  carbs_g: 'total_carbs_g',
  fat_g: 'total_fat_g'
}

const totalFor = (version: any, key: string) => version[COLUMN[key]] ?? null

const chartPoints = computed(() =>
  chronological.value.map((v: any) => ({ date: v.start_date, value: totalFor(v, metric.value) ?? 0 }))
)

const formatY = (value: number) => formatNutrientValue(value, metric.value)

const toggle = (id: string) => {
  const next = new Set(expanded.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expanded.value = next
}
</script>
