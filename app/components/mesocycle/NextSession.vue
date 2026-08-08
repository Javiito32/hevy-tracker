<template>
  <div v-if="data?.has_plan" class="bg-slate-900 rounded-xl border border-indigo-900/60 overflow-hidden">
    <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h2 class="text-base font-semibold text-slate-100">
          Próxima sesión · {{ data.session.name }}
        </h2>
        <p class="text-xs text-slate-500 mt-0.5">
          Semana {{ data.week }}
          <span v-if="data.is_deload" class="text-amber-400 font-medium">· descarga</span>
        </p>
      </div>
      <button
        @click="$emit('push')"
        class="text-xs bg-slate-800 border border-slate-700 text-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-700 transition"
      >
        Enviar a Hevy
      </button>
    </div>

    <p v-if="data.week_notes" class="px-6 pt-3 text-xs text-slate-400">{{ data.week_notes }}</p>

    <div class="divide-y divide-slate-800">
      <div v-for="ex in data.exercises" :key="ex.id" class="px-6 py-3.5">
        <div class="flex items-baseline justify-between gap-3 flex-wrap">
          <span class="text-sm font-medium text-slate-200">{{ ex.name }}</span>
          <span class="text-xs text-slate-500 tabular-nums whitespace-nowrap">
            {{ ex.target_sets }}×{{ repRange(ex) }}
            <span v-if="ex.effective_rir != null"> @{{ ex.effective_rir }} RIR</span>
          </span>
        </div>

        <div class="flex items-baseline gap-2 mt-1">
          <span v-if="ex.suggestion.weight_kg" class="text-lg font-bold text-indigo-300 tabular-nums">
            {{ ex.suggestion.weight_kg }} <span class="text-xs font-normal text-slate-500">kg</span>
          </span>
          <!-- No history means no number, not a guessed one: a made-up starting
               load in a barbell app is how people get hurt. -->
          <span v-else class="text-sm text-slate-500 italic">Sin carga sugerida</span>
          <button
            @click="toggle(ex.id)"
            class="text-[11px] text-slate-600 hover:text-slate-400 transition"
          >{{ expanded.has(ex.id) ? 'ocultar por qué' : '¿por qué?' }}</button>
        </div>

        <p v-if="expanded.has(ex.id)" class="text-xs text-slate-500 mt-1.5 leading-relaxed">
          {{ ex.suggestion.basis }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ data: any }>()
defineEmits<{ push: [] }>()

const expanded = ref(new Set<string>())
const toggle = (id: string) => {
  const next = new Set(expanded.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expanded.value = next
}

const repRange = (ex: { rep_min: number | null; rep_max: number | null }) => {
  if (ex.rep_min && ex.rep_max) return ex.rep_min === ex.rep_max ? ex.rep_min : `${ex.rep_min}-${ex.rep_max}`
  return ex.rep_min ?? ex.rep_max ?? '?'
}
</script>
