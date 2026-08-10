<template>
  <UiCard
    v-if="data?.has_plan"
    eyebrow="Lo siguiente"
    :title="`Próxima sesión · ${data.session.name}`"
    flush
  >
    <template #header>
      <div>
        <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-1">Lo siguiente</p>
        <h2 class="font-display text-sm font-semibold tracking-tight text-ink">
          Próxima sesión · {{ data.session.name }}
        </h2>
        <p class="font-data text-xs text-ink-3 mt-1">
          Semana {{ data.week }}<span v-if="data.is_deload" class="text-warn font-medium"> · descarga</span>
        </p>
        <!-- Which session is due is a reading of the athlete's week, and they
             are the only one who can tell whether it read it right. -->
        <p v-if="basis" class="text-xs text-ink-3 mt-1">{{ basis }}</p>
      </div>
    </template>

    <template #actions>
      <UiButton size="sm" variant="secondary" @click="$emit('push')">Enviar a Hevy</UiButton>
    </template>

    <p v-if="data.week_notes" class="px-5 pt-4 text-xs text-ink-2">{{ data.week_notes }}</p>

    <ul class="divide-y divide-line">
      <li v-for="ex in data.exercises" :key="ex.id" class="px-5 py-3.5">
        <div class="flex items-baseline justify-between gap-3 flex-wrap">
          <span class="text-sm font-medium text-ink">{{ ex.name }}</span>
          <span class="font-data text-xs text-ink-3 whitespace-nowrap">
            {{ ex.target_sets }}×{{ repRange(ex) }}
            <span v-if="ex.effective_rir != null"> @{{ ex.effective_rir }} RIR</span>
          </span>
        </div>

        <div class="flex items-baseline gap-2.5 mt-1">
          <span v-if="ex.suggestion.weight_kg" class="font-data text-lg text-ink leading-none">
            {{ ex.suggestion.weight_kg }}<span class="text-xs text-ink-3 ml-1">kg</span>
          </span>
          <!-- No history means no number, not a guessed one: a made-up starting
               load in a barbell app is how people get hurt. -->
          <span v-else class="text-sm text-ink-3">Sin carga sugerida</span>
          <button
            class="text-[11px] text-ink-3 hover:text-ink transition"
            @click="toggle(ex.id)"
          >{{ expanded.has(ex.id) ? 'ocultar por qué' : '¿por qué?' }}</button>
        </div>

        <p v-if="expanded.has(ex.id)" class="text-xs text-ink-3 mt-1.5 leading-relaxed">
          {{ ex.suggestion.basis }}
        </p>
      </li>
    </ul>
  </UiCard>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ data: any }>()
defineEmits<{ push: [] }>()

const DAY_NAMES = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/**
 * One line saying why this session and not another.
 *
 * The case worth naming out loud is "you already trained today": the card used
 * to keep prescribing the session just finished, and without a reason line
 * there was no way to tell a correct reading from a stuck one.
 */
const basis = computed(() => {
  const d = props.data
  if (!d?.has_plan) return null
  const done = d.last_trained && d.trained_today
    ? `Hoy ya registraste «${d.last_trained.session_name}».`
    : null

  switch (d.reason) {
    case 'weekday':
      return done ?? 'Es la sesión que el plan asigna a hoy.'
    case 'next_weekday': {
      const day = d.session.day_of_week ? DAY_NAMES[d.session.day_of_week] : null
      const next = day ? `Toca el ${day}.` : 'Es el siguiente día que asigna el plan.'
      return done ? `${done} ${next}` : next
    }
    case 'rotation':
      return done
        ? `${done} Sigue en la rotación del plan.`
        : `Sigue a «${d.last_trained?.session_name}», tu última sesión.`
    case 'start':
      return 'Primera sesión del bloque: aún no hay nada registrado que la continúe.'
    default:
      return null
  }
})

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
