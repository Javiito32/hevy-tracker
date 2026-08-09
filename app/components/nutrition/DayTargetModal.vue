<template>
  <UiModal
    :open="open"
    :title="`Objetivo del ${WEEKDAY_LABELS[weekday]?.toLowerCase()}`"
    hint="Déjalo vacío para que este día siga el objetivo general de la dieta."
    size="md"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <UiField v-for="key in MACRO_KEYS" :key="key" :label="NUTRIENT_SHORT_LABELS[key]" :unit="NUTRIENT_UNITS[key]">
          <template #default="{ id }">
            <UiInput
              :id="id"
              v-model="form[key]"
              type="number"
              min="0"
              step="1"
              :placeholder="basePlaceholder(key)"
            />
          </template>
        </UiField>
      </div>

      <p class="text-xs text-ink-3">
        El texto gris de cada casilla es el objetivo general
        <template v-if="!anyBaseTarget">, que aún no has fijado</template>.
        Lo que escribas aquí solo afecta al {{ WEEKDAY_LABELS[weekday]?.toLowerCase() }}.
      </p>

      <label class="flex items-start gap-3 px-3 py-2.5 rounded-lg border border-line hover:border-line-strong transition cursor-pointer">
        <input v-model="applyToAll" type="checkbox" class="accent-ink mt-0.5" />
        <span class="text-sm text-ink-2">
          Aplicar también al resto de días
          <span class="block text-xs text-ink-3 mt-0.5">Sobrescribe el objetivo propio de los otros seis días.</span>
        </span>
      </label>
    </div>

    <template #footer>
      <UiButton v-if="hasOverride" variant="danger" :loading="clearing" @click="clear">Quitar objetivo propio</UiButton>
      <UiButton variant="ghost" @click="emit('close')">Cancelar</UiButton>
      <UiButton :loading="working" @click="submit">Guardar</UiButton>
    </template>
  </UiModal>
</template>

<script setup lang="ts">
import { reactive, ref, watch, computed } from 'vue'

/**
 * The per-weekday target override.
 *
 * Targets are edited from the day tab you are already on rather than in a 7×4
 * grid: one mental model for meals and targets both, and 28 number fields is a
 * form nobody fills in. Empty means "inherit", which is why the base target is
 * the placeholder — the field shows what the day gets if you leave it alone.
 */
const props = defineProps<{
  open: boolean
  versionId: string
  weekday: number
  /** The version's base targets, used as placeholders. */
  baseTargets: Record<string, number | null>
  /** This day's effective target, including `overridden`. */
  dayTarget: { kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; overridden: boolean }
}>()

const emit = defineEmits<{ close: []; saved: [] }>()

const toast = useToast()

const form = reactive<Record<string, string | number | null>>({
  kcal: '', protein_g: '', carbs_g: '', fat_g: ''
})
const applyToAll = ref(false)
const working = ref(false)
const clearing = ref(false)

const hasOverride = computed(() => props.dayTarget?.overridden)
const anyBaseTarget = computed(() => MACRO_KEYS.some(k => props.baseTargets?.[k] != null))

const basePlaceholder = (key: string) => {
  const base = props.baseTargets?.[key]
  return base == null ? '—' : String(Math.round(base))
}

// Only a real override prefills the form. Prefilling from the inherited base
// would turn "leave it alone" into an override the moment the user saves.
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    applyToAll.value = false
    for (const key of MACRO_KEYS) {
      form[key] = props.dayTarget?.overridden ? (props.dayTarget as any)[key] ?? '' : ''
    }
  },
  { immediate: true }
)

const save = async (values: Record<string, any>) => {
  await $fetch(`/api/nutrition/versions/${props.versionId}/day-targets`, {
    method: 'PUT',
    body: {
      weekdays: applyToAll.value ? WEEKDAYS : [props.weekday],
      target_kcal: values.kcal,
      target_protein_g: values.protein_g,
      target_carbs_g: values.carbs_g,
      target_fat_g: values.fat_g
    }
  })
  emit('saved')
}

const submit = async () => {
  working.value = true
  try {
    await save(form)
    toast.success('Objetivo guardado.')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'No se pudo guardar el objetivo.')
  } finally {
    working.value = false
  }
}

/** All four empty deletes the row server-side, so the day falls back to the base. */
const clear = async () => {
  clearing.value = true
  try {
    await save({ kcal: null, protein_g: null, carbs_g: null, fat_g: null })
    toast.success('Este día vuelve al objetivo general.')
  } catch (err: any) {
    toast.error(err?.data?.statusMessage || 'No se pudo quitar el objetivo.')
  } finally {
    clearing.value = false
  }
}
</script>
