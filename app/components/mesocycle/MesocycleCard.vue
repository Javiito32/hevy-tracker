<template>
  <NuxtLink :to="`/mesocycles/${mesocycle.id}`" class="block group">
    <UiCard class="h-full transition group-hover:border-line-strong">
      <div class="flex justify-between items-start gap-3 mb-3">
        <div class="min-w-0">
          <h3 class="font-display text-sm font-semibold tracking-tight text-ink truncate">{{ mesocycle.name }}</h3>
          <p class="font-data text-xs text-ink-3 mt-1">
            {{ formatDateShort(mesocycle.start_date) }} — {{ mesocycle.end_date ? formatDateShort(mesocycle.end_date) : 'en curso' }}
          </p>
        </div>
        <!-- The status map lives in app/utils/theme.ts. This component used to
             keep a third copy of it, and the three disagreed on `completed`. -->
        <UiBadge :status="mesocycle.status" show-glyph class="flex-shrink-0" />
      </div>

      <p class="text-sm text-ink-2 line-clamp-2" :title="mesocycle.goal ?? undefined">
        {{ mesocycle.goal || 'Sin objetivo definido.' }}
      </p>

      <div class="pt-3.5 mt-3.5 border-t border-line flex justify-between items-center text-xs">
        <span class="text-ink-3">
          <span class="font-data text-ink-2">{{ workoutCount }}</span>
          {{ workoutCount === 1 ? 'entreno' : 'entrenos' }}
        </span>
        <span class="text-ink-3 group-hover:text-ink transition">Ver plan →</span>
      </div>
    </UiCard>
  </NuxtLink>
</template>

<script setup lang="ts">
import type { Mesocycle } from '@prisma/client'

/** The whole card is the link: on a phone the card is the target you hit. */
defineProps<{
  mesocycle: Partial<Mesocycle>
  workoutCount: number
}>()
</script>
