<template>
  <UiModal
    :open="open"
    title="Copiar un día a otros"
    hint="El día de destino pasará a ser una copia exacta del de origen."
    @close="emit('close')"
  >
    <div class="space-y-5">
      <UiField label="Día de origen" hint="Solo se pueden copiar días que tengan comidas.">
        <UiSelect v-model="fromModel">
          <option v-for="day in days" :key="day.weekday" :value="day.weekday" :disabled="!day.meals_count">
            {{ WEEKDAY_LABELS[day.weekday] }} · {{ day.meals_count }} {{ day.meals_count === 1 ? 'comida' : 'comidas' }}
          </option>
        </UiSelect>
      </UiField>

      <div>
        <div class="flex items-center justify-between gap-3 mb-2">
          <span class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3">Días de destino</span>
          <div class="flex gap-1">
            <button
              v-for="shortcut in SHORTCUTS"
              :key="shortcut.label"
              type="button"
              @click="applyShortcut(shortcut.days)"
              class="text-[11px] px-2 py-1 rounded-lg bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2 transition"
            >{{ shortcut.label }}</button>
          </div>
        </div>

        <div class="space-y-1">
          <label
            v-for="day in targetable"
            :key="day.weekday"
            class="flex items-center gap-3 px-3 py-2 rounded-lg border transition cursor-pointer"
            :class="selected.includes(day.weekday)
              ? 'bg-surface-2 border-line-strong'
              : 'border-line hover:border-line-strong'"
          >
            <input v-model="selected" type="checkbox" :value="day.weekday" class="accent-ink" />
            <span class="text-sm text-ink flex-grow">{{ WEEKDAY_LABELS[day.weekday] }}</span>
            <!-- The overwrite count is visible BEFORE the click, because there is
                 no undo. This is what replace semantics owes the user. -->
            <span
              v-if="selected.includes(day.weekday) && day.meals_count"
              class="text-xs text-warn"
            >se reemplazan {{ day.meals_count }} {{ day.meals_count === 1 ? 'comida' : 'comidas' }}</span>
            <span v-else-if="!day.meals_count" class="text-xs text-ink-3">vacío</span>
          </label>
        </div>
      </div>

      <p v-if="replacedTotal" class="text-xs text-warn">
        ⚠ Se eliminarán {{ replacedTotal }} {{ replacedTotal === 1 ? 'comida' : 'comidas' }} de los días marcados. No se puede deshacer.
      </p>
    </div>

    <template #footer>
      <UiButton variant="ghost" @click="emit('close')">Cancelar</UiButton>
      <UiButton :disabled="selected.length === 0" :loading="working" @click="submit">
        {{ selected.length === 0 ? 'Elige un destino' : `Copiar a ${selected.length} ${selected.length === 1 ? 'día' : 'días'}` }}
      </UiButton>
    </template>
  </UiModal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

/**
 * Copies one weekday's meals over others.
 *
 * The copy REPLACES the target days rather than merging into them — "make
 * Tuesday look like Monday" is what the user means, and merging would leave two
 * Desayunos to delete by hand. The price of that is paid here: every day about
 * to be overwritten is named, with how many meals it loses.
 */
const props = defineProps<{
  open: boolean
  versionId: string
  days: Array<{ weekday: number; meals_count: number }>
  /** Preselected source (the tab the user is on), or target when pulling into an empty day. */
  defaultFrom?: number
  defaultTo?: number[]
}>()

const emit = defineEmits<{ close: []; copied: [] }>()

const toast = useToast()

const from = ref<number>(props.defaultFrom ?? 1)
const selected = ref<number[]>([...(props.defaultTo ?? [])])
const working = ref(false)

/**
 * A native <select> yields strings, and `v-model.number` does not apply to a
 * component whose model is a bare `defineModel` — the modifier would be handed
 * over and ignored. Coercing here keeps `from` a number, which every comparison
 * below depends on.
 */
const fromModel = computed<string | number | null>({
  get: () => from.value,
  set: (value) => { from.value = Number(value) }
})

const SHORTCUTS = [
  { label: 'Todos', days: [1, 2, 3, 4, 5, 6, 7] },
  { label: 'L–V', days: [1, 2, 3, 4, 5] },
  { label: 'S–D', days: [6, 7] }
]

const targetable = computed(() => props.days.filter(d => d.weekday !== from.value))

const replacedTotal = computed(() =>
  props.days
    .filter(d => selected.value.includes(d.weekday))
    .reduce((sum, d) => sum + d.meals_count, 0)
)

const applyShortcut = (days: number[]) => {
  selected.value = days.filter(d => d !== from.value)
}

// Reopening must not carry the previous run's selection: the user comes back
// from a different tab meaning a different day.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    from.value = props.defaultFrom ?? 1
    selected.value = [...(props.defaultTo ?? [])]
  }
)

// Choosing the source as a destination is meaningless; drop it silently rather
// than letting the server 400 on it.
watch(from, (value) => {
  selected.value = selected.value.filter(d => d !== value)
})

const submit = async () => {
  working.value = true
  try {
    await $fetch(`/api/nutrition/versions/${props.versionId}/copy-day`, {
      method: 'POST',
      body: { from_weekday: from.value, to_weekdays: selected.value }
    })
    toast.success(`Copiado a ${formatWeekdayList(selected.value, true)}.`)
    emit('copied')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'No se pudo copiar el día.')
  } finally {
    working.value = false
  }
}
</script>
