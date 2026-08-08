<template>
  <textarea
    v-if="type === 'textarea'"
    v-model="model"
    class="ui-control resize-y"
    :rows="rows"
    v-bind="$attrs"
  />
  <input v-else v-model="model" :type="type" class="ui-control" v-bind="$attrs" />
</template>

<script setup lang="ts">
/**
 * Text, number and multiline input over the shared `.ui-control` surface.
 *
 * `type="textarea"` renders a `<textarea>` rather than forcing callers to pick
 * a different component: from the form's point of view it is the same field,
 * only taller.
 */
defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  type?: string
  rows?: number
}>(), { type: 'text', rows: 3 })

const model = defineModel<string | number | null>()
</script>
