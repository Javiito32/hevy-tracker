<template>
  <div v-if="adherence?.has_plan" class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
    <div class="px-6 py-4 border-b border-slate-800">
      <div class="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 class="text-base font-semibold text-slate-100">Adherencia al plan</h2>
        <span v-if="adherence.overall_pct != null" class="text-2xl font-bold tabular-nums" :class="toneFor(adherence.overall_pct).text">
          {{ adherence.overall_pct }}%
        </span>
      </div>
      <p class="text-xs text-slate-500 mt-1">
        Series realizadas frente a las prescritas en {{ adherence.weeks_elapsed }}
        {{ adherence.weeks_elapsed === 1 ? 'semana' : 'semanas' }} de bloque. Cuenta lo que hiciste, no si apareciste.
      </p>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-slate-800 text-xs text-slate-500 uppercase tracking-wider">
          <tr>
            <th class="px-4 py-2 text-left">Ejercicio</th>
            <th class="px-4 py-2 text-left hidden sm:table-cell">Sesión</th>
            <th class="px-4 py-2 text-right">Prescritas</th>
            <th class="px-4 py-2 text-right">Hechas</th>
            <th class="px-4 py-2 text-left w-32">Adherencia</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-800">
          <tr v-for="row in adherence.rows" :key="row.session + row.exercise" class="hover:bg-slate-800/50 transition">
            <td class="px-4 py-2 text-slate-300">{{ row.exercise }}</td>
            <td class="px-4 py-2 text-slate-600 text-xs hidden sm:table-cell">{{ row.session }}</td>
            <td class="px-4 py-2 text-right text-slate-500 tabular-nums">{{ row.planned_sets_to_date }}</td>
            <td class="px-4 py-2 text-right text-slate-300 tabular-nums font-medium">{{ row.actual_sets }}</td>
            <td class="px-4 py-2">
              <div v-if="row.adherence_pct != null" class="flex items-center gap-2">
                <div class="flex-1 bg-slate-950 rounded h-1.5 min-w-[3rem]">
                  <div
                    class="h-1.5 rounded-r-[3px] transition-all"
                    :class="toneFor(row.adherence_pct).bar"
                    :style="{ width: Math.min(100, row.adherence_pct) + '%' }"
                  ></div>
                </div>
                <span class="text-xs tabular-nums w-10 text-right" :class="toneFor(row.adherence_pct).text">
                  {{ row.adherence_pct }}%
                </span>
              </div>
              <span v-else class="text-xs text-slate-600">{{ NO_VALUE }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ adherence: any }>()

/**
 * Three bands, and over-performing is not scored as green: doing 150% of the
 * prescribed sets is a deviation from the plan, not adherence to it.
 */
const toneFor = (pct: number) => {
  if (pct >= 130) return { text: 'text-amber-400', bar: 'bg-amber-500' }
  if (pct >= 80) return { text: 'text-emerald-400', bar: 'bg-emerald-500' }
  if (pct >= 50) return { text: 'text-slate-300', bar: 'bg-slate-500' }
  return { text: 'text-rose-400', bar: 'bg-rose-500' }
}
</script>
