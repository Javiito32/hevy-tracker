<template>
  <div class="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-10">
    <div class="w-full max-w-sm">
      <div class="flex items-center gap-2.5 mb-8">
        <svg class="w-5 h-5 text-ink" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="M2 5h20" stroke-width="2" stroke-linecap="round" />
          <path d="M6.5 5v4M11 5v7M15.5 5v4M20 5v10" stroke-width="1.75" stroke-linecap="round" />
        </svg>
        <span class="font-display text-sm font-semibold tracking-eyebrow">
          <span class="text-ink">HEVY</span><span class="text-ink-3">TRACKER</span>
        </span>
      </div>

      <slot />
    </div>

    <ToastHost />
  </div>
</template>

<script setup lang="ts">
/**
 * Shell for the signed-out pages. `login.vue` and `register.vue` each carried a
 * byte-identical copy of this markup, which is how they ended up with the same
 * form styled twice.
 *
 * The mark sits top-left rather than centred over the card: signing in is a
 * doorway, not a landing page, and a centred logo with a tagline invites the
 * reader to stop and admire it.
 */
</script>
