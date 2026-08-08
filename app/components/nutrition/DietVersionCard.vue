<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
    <button
      @click="$emit('toggle')"
      class="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition text-left"
    >
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-sm font-semibold text-slate-200">v{{ version.version_number }}</span>
          <span class="text-xs px-2 py-0.5 rounded-full" :class="VERSION_STATUS_BADGES[version.status]">
            {{ VERSION_STATUS_LABELS[version.status] }}
          </span>
          <span class="text-xs text-slate-500">{{ dateRange }}</span>
        </div>
        <p v-if="version.change_note" class="text-sm text-slate-400 mt-1 truncate">{{ version.change_note }}</p>
      </div>

      <div class="flex items-center gap-4 flex-shrink-0">
        <div class="text-right">
          <div class="text-sm text-slate-300">{{ formatNutrientValue(version.total_kcal, 'kcal') }} kcal</div>
          <div class="text-xs text-slate-600">{{ version.meals_count }} comidas</div>
        </div>
        <span class="text-slate-600 text-xs">{{ expanded ? '▲' : '▼' }}</span>
      </div>
    </button>

    <div v-if="expanded" class="border-t border-slate-800 px-5 py-4">
      <div class="grid grid-cols-4 gap-2 text-center mb-4">
        <div v-for="key in MACRO_KEYS" :key="key" class="bg-slate-800/50 rounded-lg py-2">
          <div class="text-sm text-slate-200">{{ formatNutrientValue(totalFor(key), key) }}</div>
          <div class="text-[10px] text-slate-500 uppercase tracking-wider">{{ NUTRIENT_SHORT_LABELS[key] }}</div>
        </div>
      </div>

      <div v-if="pending" class="flex justify-center py-6">
        <div class="animate-spin w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent"></div>
      </div>

      <div v-else-if="detail" class="space-y-3">
        <div v-for="meal in detail.version.meals" :key="meal.id">
          <div class="flex items-center justify-between text-xs mb-1">
            <span class="text-slate-400 font-medium">
              {{ meal.name }}
              <span v-if="meal.time_of_day" class="text-slate-600 ml-1">{{ meal.time_of_day }}</span>
              <span v-if="meal.day_type !== 'all'" class="text-slate-600 ml-1">· {{ DAY_TYPE_LABELS[meal.day_type] }}</span>
            </span>
          </div>
          <ul class="text-sm text-slate-500 space-y-0.5 pl-3 border-l border-slate-800">
            <li v-for="item in meal.items" :key="item.id" class="flex justify-between gap-3">
              <span class="truncate">{{ item.food_name }}</span>
              <span class="text-slate-600 flex-shrink-0">{{ formatGrams(item.quantity_g) }}</span>
            </li>
            <li v-if="!meal.items.length" class="text-slate-700 text-xs">Sin alimentos</li>
          </ul>
        </div>
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
