<template>
  <div class="bg-surface rounded-card border border-line overflow-hidden">
    <button
      @click="$emit('toggle')"
      class="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-surface-2/40 transition text-left"
    >
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-semibold text-ink">v{{ version.version_number }}</span>
          <span class="text-xs px-2 py-0.5 rounded-full" :class="VERSION_STATUS_BADGES[version.status]">
            {{ VERSION_STATUS_LABELS[version.status] }}
          </span>
          <span class="text-xs text-ink-3">{{ dateRange }}</span>
        </div>
        <p v-if="version.change_note" class="text-sm text-ink-2 mt-1 truncate">{{ version.change_note }}</p>
      </div>

      <div class="flex items-center gap-4 flex-shrink-0">
        <!-- The figure is a mean, so it is labelled as one and travels with the
             number of days it averages. "28 comidas" (four slots × seven days)
             would be true and useless. -->
        <div class="text-right">
          <div class="text-sm text-ink-2">{{ formatNutrientValue(version.total_kcal, 'kcal') }} kcal/día</div>
          <div class="text-xs text-ink-3">
            media de {{ version.planned_days ?? 0 }} {{ (version.planned_days ?? 0) === 1 ? 'día' : 'días' }}
          </div>
        </div>
        <span class="text-ink-3 text-xs">{{ expanded ? '▲' : '▼' }}</span>
      </div>
    </button>

    <div v-if="expanded" class="border-t border-line px-5 py-4">
      <div class="grid grid-cols-4 gap-2 text-center mb-4">
        <div v-for="key in MACRO_KEYS" :key="key" class="bg-surface-2/50 rounded-lg py-2">
          <div class="text-sm text-ink">{{ formatNutrientValue(totalFor(key), key) }}</div>
          <div class="text-[10px] text-ink-3 uppercase tracking-wide">{{ NUTRIENT_SHORT_LABELS[key] }}</div>
        </div>
      </div>

      <div v-if="pending" class="flex justify-center py-6">
        <UiSpinner class="text-ink-3" />
      </div>

      <!-- Grouped by identical day, so five equal weekdays render once instead
           of five times. The grouping comes from the server so the history, the
           designer and the AI all mean the same thing by "the same day". -->
      <div v-else-if="detail" class="space-y-5">
        <div v-for="(group, index) in detail.version.day_groups" :key="index">
          <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-2">
            {{ group.weekdays.map((d: number) => WEEKDAY_SHORT[d]).join(' · ') }}
          </p>
          <div class="space-y-3">
            <div v-for="meal in group.meals" :key="meal.id">
              <div class="flex items-center justify-between text-xs mb-1">
                <span class="text-ink-2 font-medium">
                  {{ meal.name }}
                  <span v-if="meal.time_of_day" class="text-ink-3 ml-1">{{ meal.time_of_day }}</span>
                </span>
              </div>
              <ul class="text-sm text-ink-3 space-y-0.5 pl-3 border-l border-line">
                <li v-for="item in meal.items" :key="item.id" class="flex justify-between gap-3">
                  <span class="truncate">{{ item.food_name }}</span>
                  <span class="text-ink-3 flex-shrink-0">{{ formatGrams(item.quantity_g) }}</span>
                </li>
                <li v-if="!meal.items.length" class="text-ink-3 text-xs">Sin alimentos</li>
              </ul>
            </div>
          </div>
        </div>
        <p v-if="!detail.version.day_groups?.length" class="text-sm text-ink-3">
          Esta versión no tiene ningún día con alimentos.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ version: any; expanded?: boolean }>()
defineEmits<{ toggle: [] }>()

// Meals are only fetched once the card is opened — the history list itself runs
// off the denormalised totals and never needs them.
const { data: detail, pending } = useFetch<any>(() => `/api/nutrition/versions/${props.version.id}`, {
  immediate: false,
  watch: [() => props.expanded],
  server: false
})

const COLUMN: Record<string, string> = {
  kcal: 'total_kcal',
  protein_g: 'total_protein_g',
  carbs_g: 'total_carbs_g',
  fat_g: 'total_fat_g'
}

const totalFor = (key: string) => props.version[COLUMN[key]] ?? null

const dateRange = computed(() => {
  if (!props.version.start_date) return 'Sin publicar'
  const from = formatDateShort(props.version.start_date)
  return props.version.end_date ? `${from} → ${formatDateShort(props.version.end_date)}` : `Desde ${from}`
})
</script>
