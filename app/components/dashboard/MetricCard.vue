<template>
  <div :class="['bg-white rounded-lg shadow p-6 border-t-4', colorClass]">
    <h2 class="text-lg font-semibold text-gray-700 mb-2">{{ title }}</h2>
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
    blue: 'border-blue-500',
    green: 'border-green-500',
    purple: 'border-purple-500',
    red: 'border-red-500',
    yellow: 'border-yellow-500'
  }
  return colors[props.color] || colors.blue
})
</script>
