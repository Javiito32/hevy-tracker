<template>
  <div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
    <div class="px-5 py-3 border-b border-slate-800 flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 min-w-0">
        <template v-if="editable && renaming">
          <input
            v-model="draftName"
            type="text"
            class="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
            @keydown.enter="commitName"
            @keydown.esc="renaming = false"
          />
          <input
            v-model="draftTime"
            type="time"
            class="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
          />
          <button @click="commitName" class="text-emerald-400 hover:text-emerald-300 text-sm transition">✓</button>
          <button @click="renaming = false" class="text-slate-500 hover:text-slate-300 text-sm transition">✕</button>
        </template>
        <template v-else>
          <h3 class="font-semibold text-slate-200 truncate">{{ meal.name }}</h3>
          <span v-if="meal.time_of_day" class="text-xs text-slate-500">{{ meal.time_of_day }}</span>
          <span
            v-if="meal.day_type && meal.day_type !== 'all'"
            class="text-[10px] px-1.5 py-0.5 rounded-full"
            :class="meal.day_type === 'training' ? 'bg-indigo-950/60 text-indigo-400' : 'bg-slate-800 text-slate-500'"
          >
            {{ DAY_TYPE_LABELS[meal.day_type] }}
          </span>
          <button
            v-if="editable"
            @click="startRename"
            class="text-slate-600 hover:text-slate-300 text-xs transition"
            title="Renombrar"
          >✎</button>
        </template>
      </div>

      <div class="flex items-center gap-3 flex-shrink-0">
        <span class="text-sm text-slate-400">{{ formatNutrientValue(mealTotals.kcal, 'kcal') }} kcal</span>
        <button
          v-if="editable"
          @click="$emit('delete-meal', meal)"
          class="text-slate-600 hover:text-rose-400 text-sm transition"
          title="Eliminar comida"
        >🗑</button>
      </div>
    </div>

    <div v-if="!meal.items.length" class="px-5 py-6 text-center text-sm text-slate-600">
      Sin alimentos.
    </div>

    <div v-else class="divide-y divide-slate-800/50">
      <div
        v-for="item in meal.items"
        :key="item.id"
        class="px-5 py-2.5 flex items-center gap-3 hover:bg-slate-800/30 transition group"
      >
        <div class="min-w-0 flex-grow">
          <div class="text-sm text-slate-200 truncate">
            {{ item.food_name }}
            <span
              v-if="!item.food_id"
              class="text-[10px] text-slate-600 ml-1"
              title="El alimento ya no está en el catálogo. Sus valores se conservan tal como estaban."
            >(fuera del catálogo)</span>
          </div>
          <div class="text-xs text-slate-600">
            {{ perItemLine(item) }}
          </div>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <template v-if="editable">
            <div class="flex items-center bg-slate-800 border border-slate-700 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 transition w-24">
              <input
                :value="item.quantity_g"
                type="number"
                min="0"
                step="1"
                class="w-full bg-transparent px-2 py-1 text-slate-100 text-sm focus:outline-none min-w-0"
                @change="commitQuantity(item, ($event.target as HTMLInputElement).value)"
              />
              <span class="px-1.5 text-xs text-slate-600 flex-shrink-0">g</span>
            </div>
            <button
              @click="$emit('delete-item', item)"
              class="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400 text-sm transition"
              title="Quitar"
            >×</button>
          </template>
          <span v-else class="text-sm text-slate-400 w-24 text-right">{{ formatGrams(item.quantity_g) }}</span>
        </div>
      </div>
    </div>

    <div v-if="editable" class="px-5 py-3 border-t border-slate-800">
      <button
        @click="$emit('add-food', meal)"
        class="text-sm text-indigo-400 hover:text-indigo-300 transition"
      >
        + Añadir alimento
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ meal: any; editable?: boolean }>()
const emit = defineEmits<{
  'add-food': [meal: any]
  'delete-meal': [meal: any]
  'delete-item': [item: any]
  changed: []
}>()

const renaming = ref(false)
const draftName = ref('')
const draftTime = ref('')

const startRename = () => {
  draftName.value = props.meal.name
  draftTime.value = props.meal.time_of_day ?? ''
  renaming.value = true
}

const commitName = async () => {
  const name = draftName.value.trim()
  if (!name) return
  renaming.value = false
  await $fetch(`/api/nutrition/meals/${props.meal.id}`, {
    method: 'PATCH',
    body: { name, time_of_day: draftTime.value || null }
  })
  emit('changed')
}

const commitQuantity = async (item: any, raw: string) => {
  const grams = Number(raw)
  if (!Number.isFinite(grams) || grams <= 0 || grams === item.quantity_g) return
  await $fetch(`/api/nutrition/items/${item.id}`, { method: 'PATCH', body: { quantity_g: grams } })
  emit('changed')
}

/** Per-item macros, scaled client-side from the item's own stored snapshot. */
const perItemLine = (item: any) => {
  const n = scaleSnapshot(item.nutrients_snapshot, item.quantity_g)
  return `${formatNutrientValue(n.kcal, 'kcal')} kcal · P ${formatNutrientValue(n.protein_g, 'protein_g')} · C ${formatNutrientValue(n.carbs_g, 'carbs_g')} · G ${formatNutrientValue(n.fat_g, 'fat_g')}`
}

const mealTotals = computed(() => {
  let kcal: number | null = 0
  for (const item of props.meal.items ?? []) {
    const value = scaleSnapshot(item.nutrients_snapshot, item.quantity_g).kcal
    if (value == null) {
      kcal = null
      break
    }
    kcal += value
  }
  return { kcal }
})
</script>
