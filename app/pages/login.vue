<template>
  <div class="min-h-screen bg-gray-50 flex items-center justify-center px-4">
    <div class="bg-white rounded-xl shadow-md p-8 w-full max-w-sm">
      <div class="text-center mb-6">
        <span class="text-4xl">🏋️</span>
        <h1 class="text-2xl font-bold text-gray-800 mt-2">HevyTracker</h1>
        <p class="text-sm text-gray-500 mt-1">Inicia sesión en tu cuenta</p>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input v-model="form.email" type="email" required autocomplete="email"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="tu@email.com" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
          <input v-model="form.password" type="password" required autocomplete="current-password"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="••••••••" />
        </div>

        <div v-if="error" class="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{{ error }}</div>

        <button type="submit" :disabled="loading"
          class="w-full bg-blue-600 text-white py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition">
          {{ loading ? 'Iniciando sesión...' : 'Iniciar sesión' }}
        </button>
      </form>

      <p class="text-center text-sm text-gray-500 mt-4">
        ¿No tienes cuenta?
        <NuxtLink to="/register" class="text-blue-600 hover:underline font-medium">Regístrate</NuxtLink>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

const { fetch: refreshSession } = useUserSession()
const form = ref({ email: '', password: '' })
const loading = ref(false)
const error = ref('')

const handleLogin = async () => {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/auth/login', { method: 'POST', body: form.value })
    await refreshSession()
    await navigateTo('/')
  } catch (err: any) {
    error.value = err?.data?.message || 'Credenciales incorrectas'
  } finally {
    loading.value = false
  }
}
</script>
