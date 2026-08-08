<template>
  <div class="relative">
    <select v-model="model" class="ui-control appearance-none pr-9 cursor-pointer" v-bind="$attrs">
      <slot />
    </select>
    <svg
      class="w-4 h-4 text-ink-3 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
      fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
    >
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </div>
</template>

<script setup lang="ts">
/** Native select on the shared control surface, with the platform arrow replaced
 *  so it matches in both themes. */
defineOptions({ inheritAttrs: false })
const model = defineModel<string | number | null>()
</script>
