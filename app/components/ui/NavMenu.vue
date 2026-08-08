<template>
  <div ref="root" class="relative">
    <button
      class="relative flex items-center gap-1 px-2.5 py-1.5 rounded transition-colors whitespace-nowrap"
      :class="groupActive ? 'text-ink' : 'text-ink-3 hover:text-ink'"
      :aria-expanded="open"
      aria-haspopup="true"
      @click="open = !open"
    >
      {{ label }}
      <svg
        class="w-3 h-3 opacity-60 transition-transform"
        :class="open && 'rotate-180'"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
      <!-- The group carries the marker when any of its pages is open, so the
           rule still answers "where am I" without expanding anything. -->
      <span v-if="groupActive" class="absolute inset-x-2.5 -bottom-px h-px bg-ink" aria-hidden="true" />
    </button>

    <div
      v-if="open"
      class="absolute left-0 mt-2 w-60 bg-surface border border-line-strong rounded-card z-50 overflow-hidden py-1"
    >
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="block px-3 py-2 transition"
        :class="isActive(item.to) ? 'bg-surface-2' : 'hover:bg-surface-2'"
        :aria-current="isActive(item.to) ? 'page' : undefined"
        @click="open = false"
      >
        <span class="text-sm block" :class="isActive(item.to) ? 'text-ink font-medium' : 'text-ink-2'">
          {{ item.label }}
        </span>
        <!-- One line saying what the page answers. Eleven flat links gave no
             clue what "Volumen" measured or how it differed from "Progreso". -->
        <span v-if="item.hint" class="text-[11px] text-ink-3 block mt-0.5">{{ item.hint }}</span>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
export interface NavItem {
  to: string
  label: string
  /** What this page answers, shown under the label. */
  hint?: string
}

const props = defineProps<{
  label: string
  items: NavItem[]
}>()

const route = useRoute()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

const isActive = (to: string) => route.path === to || route.path.startsWith(`${to}/`)

/** Highlighted when any page inside it is open. */
const groupActive = computed(() => props.items.some(i => isActive(i.to)))

const onDocumentClick = (e: MouseEvent) => {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})

watch(() => route.fullPath, () => { open.value = false })
</script>
