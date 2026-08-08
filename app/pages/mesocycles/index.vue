<template>
  <div>
    <UiPageHeader eyebrow="Planificación" title="Mesociclos">
      <template #actions>
        <UiButton to="/mesocycles/new" size="sm">Crear mesociclo</UiButton>
      </template>
    </UiPageHeader>

    <div v-if="pending" class="flex justify-center py-16 text-ink-3">
      <UiSpinner size="lg" />
    </div>

    <div v-else-if="mesocycles?.length" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <MesocycleCard
        v-for="mesocycle in mesocycles"
        :key="mesocycle.id"
        :mesocycle="mesocycle"
        :workout-count="mesocycle._count?.workouts || 0"
      />
    </div>

    <UiCard v-else flush>
      <UiEmptyState
        title="Todavía no tienes ningún mesociclo"
        description="Un mesociclo define qué entrenas cada semana y contra qué se mide tu adherencia."
        action="Crear el primero"
        to="/mesocycles/new"
      />
    </UiCard>
  </div>
</template>

<script setup lang="ts">
const { data: mesocycles, pending } = useFetch('/api/mesocycles')
</script>
