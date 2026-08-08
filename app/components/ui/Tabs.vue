<template>
  <div class="inline-flex items-center gap-0.5 bg-surface-2 border border-line rounded-lg p-0.5" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      role="tab"
      :aria-selected="tab.value === model"
      class="px-3 py-1.5 text-xs font-medium rounded-[6px] transition whitespace-nowrap min-h-[32px]"
      :class="tab.value === model
        ? 'bg-accent text-accent-ink'
        : 'text-ink-3 hover:text-ink'"
      @click="model = tab.value"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * Segmented control. The app had three unrelated implementations of this — pill
 * tabs on `progress`, a segmented control on the admin chart, a third in the
 * food search modal — which meant the same interaction looked like three
 * different things.
 *
 * The selected tab uses the contrast inversion, the same device as the primary
 * button: in an achromatic interface, "this one is chosen" is a contrast
 * statement.
 */
defineProps<{
  tabs: ReadonlyArray<{ value: string; label: string }>
}>()

const model = defineModel<string>({ required: true })
</script>
