<template>
  <div>
    <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-1.5">Tema</p>
    <!-- Rendered client-side only: the server cannot know which theme the
         browser resolved, and marking the wrong option as selected during
         hydration would flicker the choice the user just made. -->
    <ClientOnly>
      <div class="inline-flex w-full bg-surface-2 border border-line rounded-lg p-0.5" role="radiogroup" aria-label="Tema">
        <button
          v-for="opt in OPTIONS"
          :key="opt.value"
          role="radio"
          :aria-checked="colorMode.preference === opt.value"
          :title="opt.title"
          class="flex-1 px-2 py-1.5 text-[11px] font-medium rounded-[6px] transition min-h-[32px]"
          :class="colorMode.preference === opt.value
            ? 'bg-accent text-accent-ink'
            : 'text-ink-3 hover:text-ink'"
          @click="colorMode.preference = opt.value"
        >{{ opt.label }}</button>
      </div>
      <template #fallback>
        <div class="h-[38px] bg-surface-2 border border-line rounded-lg" />
      </template>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
/**
 * Three states, not a two-way switch.
 *
 * "System" has to be reachable as its own choice: a binary toggle silently
 * pins the app to whatever it was last set to, so a phone that flips to dark at
 * sunset stops following along and there is no way back short of clearing
 * storage.
 */
const colorMode = useColorMode()

const OPTIONS = [
  { value: 'light', label: 'Claro', title: 'Siempre en claro' },
  { value: 'dark', label: 'Oscuro', title: 'Siempre en oscuro' },
  { value: 'system', label: 'Sistema', title: 'Seguir la preferencia del sistema' }
] as const
</script>
