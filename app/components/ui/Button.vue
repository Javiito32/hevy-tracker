<template>
  <component
    :is="tag"
    :to="to"
    :href="href"
    :type="tag === 'button' ? type : undefined"
    :disabled="isDisabled"
    :aria-busy="loading || undefined"
    :class="[
      'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition',
      'disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none',
      SIZES[size],
      VARIANTS[variant],
      block && 'w-full'
    ]"
  >
    <UiSpinner v-if="loading" :size="size === 'lg' ? 'md' : 'sm'" />
    <slot />
  </component>
</template>

<script setup lang="ts">
/**
 * The button. Absorbs ~50 hand-written call sites that had drifted into 19
 * different spellings of the same primary button — including four different
 * disabled opacities (30/40/50/60).
 *
 * There is no blue. The primary action is a **contrast inversion**: chalk on
 * iron in the dark theme, iron on chalk in the light one. In a direction where
 * colour is reserved for verdicts, the loudest thing on the page should be
 * loud through contrast, not through hue — otherwise "save" competes with
 * "you are past your MRV".
 */
const props = withDefaults(defineProps<{
  variant?: keyof typeof VARIANTS
  size?: keyof typeof SIZES
  /** Renders a NuxtLink instead of a button. */
  to?: string
  href?: string
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  /** Shows a spinner and blocks interaction. */
  loading?: boolean
  block?: boolean
}>(), { variant: 'primary', size: 'md', type: 'button' })

const VARIANTS = {
  /** The one action this view exists for. Contrast inversion. */
  primary: 'bg-accent text-accent-ink hover:opacity-85',
  /** Everything else that is still a real action. */
  secondary: 'bg-surface-2 text-ink border border-line-strong hover:border-ink-3',
  /** Tertiary, and toolbar buttons that must not crowd the content. */
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface-2',
  /** Destructive. The only button allowed a hue, because it is a warning. */
  danger: 'bg-danger/10 text-danger border border-danger/40 hover:bg-danger/20'
} as const

const SIZES = {
  // 44px tall at `md`: this app is used on a phone, in a gym, with chalk on
  // your hands. Touch targets are not the place to save vertical space.
  sm: 'text-xs px-3 py-1.5 min-h-[34px]',
  md: 'text-sm px-4 py-2.5 min-h-[44px]',
  lg: 'text-sm px-6 py-3 min-h-[48px]'
} as const

const tag = computed(() => (props.to ? resolveComponent('NuxtLink') : props.href ? 'a' : 'button'))
const isDisabled = computed(() => (props.disabled || props.loading) && tag.value === 'button' ? true : undefined)
</script>
