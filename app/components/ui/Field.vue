<template>
  <div>
    <label :for="id" class="block text-xs font-medium text-ink-2 mb-1.5">
      {{ label }}
      <span v-if="required" class="text-ink-3" aria-hidden="true">*</span>
      <span v-if="unit" class="font-data text-ink-3 ml-1">({{ unit }})</span>
    </label>

    <slot :id="id" :describedby="describedBy" />

    <!-- The hint explains the field; the error says what to do about it. They
         never both show: an error that appears under an unchanged hint reads as
         a second hint. -->
    <p v-if="error" :id="`${id}-error`" class="text-xs text-danger mt-1.5 flex items-start gap-1">
      <span aria-hidden="true">⚠</span>{{ error }}
    </p>
    <p v-else-if="hint" :id="`${id}-hint`" class="text-xs text-ink-3 mt-1.5">{{ hint }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * Label + control + hint/error. The control goes in the default slot and gets
 * the generated `id`, so the label is really bound to it — most of the ~84
 * hand-written inputs in this app had a `<label>` with no `for` at all.
 */
const props = defineProps<{
  label: string
  /** Unit of measure, shown next to the label. This app is all kg, g and reps. */
  unit?: string
  hint?: string
  error?: string
  required?: boolean
  /** Override the generated id when the caller needs to reference it. */
  for?: string
}>()

const uid = useId()
const id = computed(() => props.for ?? `f-${uid}`)
const describedBy = computed(() =>
  props.error ? `${id.value}-error` : props.hint ? `${id.value}-hint` : undefined
)
</script>
