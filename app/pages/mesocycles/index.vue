<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-3xl font-bold text-slate-100">Mesocycles</h1>
      <NuxtLink to="/mesocycles/new" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 transition text-sm font-medium">
        Create New
      </NuxtLink>
    </div>

    <div v-if="pending" class="text-center py-10">
      <div class="animate-spin inline-block w-8 h-8 border-[3px] border-indigo-500 border-t-transparent rounded-full"></div>
    </div>
    <div v-else-if="mesocycles && mesocycles.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <MesocycleCard
        v-for="mesocycle in mesocycles"
        :key="mesocycle.id"
        :mesocycle="mesocycle"
        :workout-count="mesocycle._count?.workouts || 0"
      />
    </div>

    <div v-else class="bg-slate-900 rounded-xl border border-slate-800 p-8 text-center text-slate-500">
      <p class="mb-4">You haven't created any mesocycles yet.</p>
      <NuxtLink to="/mesocycles/new" class="inline-block bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 transition text-sm">
        Start your first block
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
const { data: mesocycles, pending } = useFetch('/api/mesocycles')
</script>
