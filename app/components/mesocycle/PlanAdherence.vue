<template>
  <UiCard
    v-if="adherence?.has_plan"
    eyebrow="Plan"
    title="Adherencia al plan"
    :hint="`Series realizadas frente a las prescritas en ${adherence.weeks_elapsed} ${adherence.weeks_elapsed === 1 ? 'semana' : 'semanas'} de bloque. Cuenta lo que hiciste, no si apareciste.`"
    flush
  >
    <template v-if="adherence.overall_pct != null" #actions>
      <span class="font-data text-2xl leading-none" :class="toneFor(adherence.overall_pct).text">
        {{ adherence.overall_pct }}%
      </span>
    </template>

    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-surface-2 text-[11px] text-ink-3 uppercase tracking-wide">
          <tr>
            <th class="px-4 py-2.5 text-left font-semibold">Ejercicio</th>
            <th class="px-4 py-2.5 text-left font-semibold hidden sm:table-cell">Sesión</th>
            <th class="px-4 py-2.5 text-right font-semibold">Prescritas</th>
            <th class="px-4 py-2.5 text-right font-semibold">Hechas</th>
            <th class="px-4 py-2.5 text-left font-semibold w-36">Adherencia</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr v-for="row in adherence.rows" :key="row.session + row.exercise" class="hover:bg-surface-2 transition">
            <td class="px-4 py-2.5 text-ink-2">{{ row.exercise }}</td>
            <td class="px-4 py-2.5 text-ink-3 text-xs hidden sm:table-cell">{{ row.session }}</td>
            <td class="px-4 py-2.5 text-right font-data text-ink-3">{{ row.planned_sets_to_date }}</td>
            <td class="px-4 py-2.5 text-right font-data font-medium text-ink">{{ row.actual_sets }}</td>
            <td class="px-4 py-2.5">
              <div v-if="row.adherence_pct != null" class="flex items-center gap-2">
                <!-- The mark at 100% is the graduated rule in miniature: without
                     it the bar only says "some", and the whole question here is
                     "how much, against what was prescribed". -->
                <div class="relative flex-1 bg-surface-2 rounded h-1.5 min-w-[3.5rem]">
                  <div
                    class="h-1.5 rounded-r-[3px] transition-all"
                    :class="toneFor(row.adherence_pct).bar"
                    :style="{ width: `${Math.min(100, (row.adherence_pct / SCALE_MAX) * 100)}%` }"
                  />
                  <span
                    class="absolute -top-0.5 -bottom-0.5 w-px bg-tick"
                    :style="{ left: `${(100 / SCALE_MAX) * 100}%` }"
                    title="100% de lo prescrito"
                    aria-hidden="true"
                  />
                </div>
                <span class="font-data text-xs w-10 text-right flex items-center justify-end gap-0.5" :class="toneFor(row.adherence_pct).text">
                  <span aria-hidden="true">{{ toneFor(row.adherence_pct).glyph }}</span>{{ row.adherence_pct }}%
                </span>
              </div>
              <span v-else class="text-xs text-ink-3">{{ NO_VALUE }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </UiCard>
</template>

<script setup lang="ts">
defineProps<{ adherence: any }>()

/** Headroom past 100% so over-performing has somewhere to show. */
const SCALE_MAX = 150

/**
 * Three bands, and over-performing is not scored as green: doing 150% of the
 * prescribed sets is a deviation from the plan, not adherence to it.
 *
 * Each band ships a glyph as well as a colour — the same rule the volume chart
 * follows, since amber and green are the pair hardest to separate here.
 */
const toneFor = (pct: number) => {
  if (pct >= 130) return { text: 'text-warn', bar: 'bg-warn', glyph: '↑' }
  if (pct >= 80) return { text: 'text-positive', bar: 'bg-positive', glyph: '✓' }
  if (pct >= 50) return { text: 'text-ink-2', bar: 'bg-ink-3', glyph: '·' }
  return { text: 'text-danger', bar: 'bg-danger', glyph: '↓' }
}
</script>
