<template>
  <div class="max-w-5xl mx-auto">
    <div class="flex flex-wrap gap-3 justify-between items-center mb-6">
      <div>
        <h1 class="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] text-ink leading-none">Histórico de la dieta</h1>
        <p class="text-sm text-ink-3 mt-1">
          Cada versión publicada queda congelada con sus fechas: esto es lo que comías en cada momento.
        </p>
      </div>
      <NuxtLink
        to="/nutrition"
        class="bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2 px-4 py-2 rounded-lg transition text-sm font-medium"
      >
        ← Dieta actual
      </NuxtLink>
    </div>

    <div v-if="pending" class="flex justify-center py-12">
      <UiSpinner size="lg" class="text-ink-3" />
    </div>

    <div v-else-if="!published.length" class="bg-surface rounded-card border border-line p-10 text-center text-ink-3">
      <p class="text-sm">Todavía no has publicado ninguna versión de la dieta.</p>
    </div>

    <div v-else class="space-y-6">
      <!-- Evolución -->
      <div class="bg-surface rounded-card border border-line overflow-hidden">
        <div class="px-5 py-3.5 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <h2 class="font-display text-sm font-semibold tracking-tight text-ink">
            Evolución de {{ NUTRIENT_LABELS[metric].toLowerCase() }}
          </h2>
          <div class="flex gap-1">
            <button
              v-for="key in MACRO_KEYS"
              :key="key"
              @click="metric = key"
              class="px-2.5 py-1 text-xs rounded-lg transition flex items-center gap-1.5"
              :class="metric === key
                ? 'bg-surface-2 text-ink'
                : 'bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2'"
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
          <p v-else class="text-sm text-ink-3 text-center py-8">
            Hace falta más de una versión publicada para dibujar la evolución.
          </p>

          <!-- Vista de tabla: ningún valor debe ser accesible sólo pasando el ratón -->
          <div class="mt-4">
            <button
              @click="showTable = !showTable"
              class="text-xs text-ink-3 hover:text-ink-2 transition"
            >
              {{ showTable ? '▲ Ocultar tabla' : '▼ Ver como tabla' }}
            </button>
            <div v-if="showTable" class="mt-3 overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-line text-[11px] text-ink-3 uppercase tracking-wide">
                    <th class="py-2 text-left">Versión</th>
                    <th class="py-2 text-left">Desde</th>
                    <th v-for="key in MACRO_KEYS" :key="key" class="py-2 text-right">
                      {{ NUTRIENT_SHORT_LABELS[key] }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="v in chronological" :key="v.id" class="border-b border-line/50">
                    <td class="py-2 text-ink-2">v{{ v.version_number }}</td>
                    <td class="py-2 text-ink-2">{{ formatDateShort(v.start_date) }}</td>
                    <td v-for="key in MACRO_KEYS" :key="key" class="py-2 text-right text-ink-2">
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
        <h2 class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3">
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
