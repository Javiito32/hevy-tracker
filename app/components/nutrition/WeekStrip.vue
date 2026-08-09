<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden">
    <div class="grid grid-cols-7">
      <button
        v-for="day in days"
        :key="day.weekday"
        type="button"
        @click="emit('update:modelValue', day.weekday)"
        class="relative px-1 py-3 text-center border-r border-line last:border-r-0 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
        :class="day.weekday === modelValue
          ? 'bg-accent text-accent-ink'
          : 'hover:bg-surface-2'"
        :aria-current="day.weekday === modelValue ? 'true' : undefined"
        :aria-label="`${WEEKDAY_LABELS[day.weekday]}: ${day.planned ? formatNutrientValue(day.totals?.kcal, 'kcal') + ' kcal' : 'sin comidas'}`"
      >
        <span
          class="block font-display text-[10px] font-semibold uppercase tracking-eyebrow"
          :class="day.weekday === modelValue ? 'text-accent-ink' : day.planned ? 'text-ink-2' : 'text-ink-3'"
        >{{ WEEKDAY_SHORT[day.weekday] }}</span>

        <!-- The kcal figure is what turns a tab bar into the week at a glance:
             with seven independent lists, "which days have I not done yet, and
             are they roughly equal" has nowhere else to be answered. -->
        <span
          class="block font-data text-xs mt-1 tabular-nums"
          :class="day.weekday === modelValue ? 'text-accent-ink' : day.planned ? 'text-ink' : 'text-ink-3'"
        >{{ day.planned ? formatNutrientValue(day.totals?.kcal, 'kcal') : NO_VALUE }}</span>

        <!-- Distance from the day's own target, not the base one. Absent when
             there is no target: a bare dot with nothing behind it is noise. -->
        <span
          v-if="deltaFor(day) !== null"
          class="block text-[10px] mt-0.5"
          :class="day.weekday === modelValue ? 'text-accent-ink/80' : onTarget(day) ? 'text-positive' : 'text-warn'"
        >{{ deltaFor(day)! > 0 ? '+' : '' }}{{ deltaFor(day) }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The seven weekday tabs, each carrying that day's energy.
 *
 * It is the day selector and the weekly overview in one control, which is what
 * earns it a component of its own rather than a bare `UiTabs`.
 */
const props = defineProps<{
  /** The `days` array from serializeVersion: weekday, planned, totals, target. */
  days: Array<{
    weekday: number
    planned: boolean
    totals: Record<string, number | null> | null
    target: { kcal: number | null }
  }>
  modelValue: number
}>()

const emit = defineEmits<{ 'update:modelValue': [weekday: number] }>()

/** Null unless the day is planned AND has a target — otherwise there is no delta. */
const deltaFor = (day: (typeof props.days)[number]): number | null => {
  if (!day.planned || !day.target?.kcal || day.totals?.kcal == null) return null
  return Math.round(day.totals.kcal - day.target.kcal)
}

/** Same ±50 kcal band NutrientTotals uses, so the two never disagree. */
const onTarget = (day: (typeof props.days)[number]) => {
  const delta = deltaFor(day)
  return delta !== null && Math.abs(delta) <= 50
}
</script>
