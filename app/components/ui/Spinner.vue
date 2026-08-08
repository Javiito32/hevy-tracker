<template>
  <span
    role="status"
    :aria-label="label"
    :class="[
      'inline-block rounded-full border-2 border-current border-t-transparent animate-spin align-[-0.125em]',
      SIZES[size]
    ]"
  />
</template>

<script setup lang="ts">
/**
 * Loading spinner. Replaces 29 hand-rolled copies across 22 files, which came
 * in two arbitrary sizes and always hardcoded `border-indigo-500`.
 *
 * `border-current` means it inherits the text colour of wherever it lands, so
 * it works on a surface, inside a primary button (where the ground is inverted)
 * and inside a danger button without any per-site colour.
 */
withDefaults(defineProps<{
  size?: keyof typeof SIZES
  label?: string
}>(), { size: 'md', label: 'Cargando' })

const SIZES = {
  sm: 'w-3.5 h-3.5',
  md: 'w-5 h-5',
  lg: 'w-8 h-8'
} as const
</script>
