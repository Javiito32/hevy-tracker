<template>
  <div class="min-h-screen bg-slate-950 flex items-center justify-center px-4 font-sans">
    <div class="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl shadow-black/50 p-8 w-full max-w-sm">
      <div class="text-center mb-8">
        <span class="text-4xl">🏋️</span>
        <h1 class="text-2xl font-bold text-slate-50 mt-3">HevyTracker</h1>
        <p class="text-sm text-slate-500 mt-1">Inicia sesión en tu cuenta</p>
      </div>

      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-400 mb-1.5">Email</label>
          <input v-model="form.email" type="email" required autocomplete="email"
            class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            placeholder="tu@email.com" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-400 mb-1.5">Contraseña</label>
          <input v-model="form.password" type="password" required autocomplete="current-password"
            class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
            placeholder="••••••••" />
        </div>

        <div v-if="error" class="bg-rose-950/60 border border-rose-800 text-rose-400 px-3 py-2 rounded-lg text-sm">{{ error }}</div>

        <button type="submit" :disabled="loading"
          class="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium hover:bg-indigo-500 disabled:opacity-50 transition mt-2">
          {{ loading ? 'Iniciando sesión...' : 'Iniciar sesión' }}
        </button>
      </form>

      <p class="text-center text-sm text-slate-500 mt-6">
        ¿No tienes cuenta?
        <NuxtLink to="/register" class="text-indigo-400 hover:text-indigo-300 font-medium transition">Regístrate</NuxtLink>
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
