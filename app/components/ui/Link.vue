<template>
  <component
    :is="to ? NuxtLink : 'a'"
    :to="to"
    :href="href"
    class="text-ink underline decoration-line-strong underline-offset-[3px]
           hover:decoration-ink transition-colors"
  >
    <slot />
  </component>
</template>

<script setup lang="ts">
/**
 * Inline link.
 *
 * Underlined ink, not a coloured word. With no brand hue there is no "link
 * blue" left to lean on — and the underline was always the more reliable
 * affordance anyway, since it survives both themes and colour-vision
 * deficiency. This replaces ~60 `text-indigo-400 hover:text-indigo-300` sites.
 */
defineProps<{ to?: string; href?: string }>()
const NuxtLink = resolveComponent('NuxtLink')
</script>
