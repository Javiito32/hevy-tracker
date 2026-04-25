<template>
  <div :class="['bg-slate-900 rounded-xl border border-slate-800 p-6 border-t-4 transition hover:border-slate-700', colorClass]">
    <h2 class="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wider">{{ title }}</h2>
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  color: 'blue' | 'green' | 'purple' | 'red' | 'yellow'
}>()

const colorClass = computed(() => {
  const colors = {
    blue: 'border-t-indigo-500',
    green: 'border-t-emerald-500',
    purple: 'border-t-violet-500',
    red: 'border-t-rose-500',
    yellow: 'border-t-amber-500'
  }
  return colors[props.color] || colors.blue
})
</script>
