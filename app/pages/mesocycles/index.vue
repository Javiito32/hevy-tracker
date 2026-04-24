<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-3xl font-bold text-gray-800">Mesocycles</h1>
      <NuxtLink to="/mesocycles/new" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition shadow">
        Create New
      </NuxtLink>
    </div>
    
    <div v-if="pending" class="text-center py-10">
      <div class="animate-spin inline-block w-8 h-8 border-[3px] border-current border-t-transparent text-blue-600 rounded-full" role="status" aria-label="loading"></div>
    </div>
    <div v-else-if="mesocycles && mesocycles.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <MesocycleCard 
        v-for="mesocycle in mesocycles" 
        :key="mesocycle.id"
        :mesocycle="mesocycle"
        :workout-count="mesocycle._count?.workouts || 0"
      />
    </div>
    
    <div v-else class="bg-white rounded-lg shadow p-8 text-center text-gray-500">
      <p class="mb-4">You haven't created any mesocycles yet.</p>
      <NuxtLink to="/mesocycles/new" class="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition">
        Start your first block
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
// Fetch real data from our endpoint
const { data: mesocycles, pending } = useFetch('/api/mesocycles')
</script>
