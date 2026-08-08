<template>
  <div>
    <h1 class="font-display text-xl font-semibold tracking-tight text-ink">Inicia sesión</h1>
    <p class="text-sm text-ink-3 mt-1.5 mb-7">Entra para ver tus entrenos y tu progreso.</p>

    <form class="space-y-4" @submit.prevent="handleLogin">
      <UiField v-slot="{ id }" label="Email">
        <UiInput :id="id" v-model="form.email" type="email" required autocomplete="email" placeholder="tu@email.com" />
      </UiField>

      <UiField v-slot="{ id }" label="Contraseña">
        <UiInput :id="id" v-model="form.password" type="password" required autocomplete="current-password" placeholder="••••••••" />
      </UiField>

      <!-- Errors say what happened and stay put until the next attempt. -->
      <p v-if="error" class="text-sm text-danger flex items-start gap-2 bg-danger/5 border border-danger/30 rounded-lg px-3 py-2.5">
        <span aria-hidden="true">⚠</span>{{ error }}
      </p>

      <UiButton type="submit" :loading="loading" block class="mt-2">
        {{ loading ? 'Entrando…' : 'Iniciar sesión' }}
      </UiButton>
    </form>

    <p class="text-sm text-ink-3 mt-7">
      ¿No tienes cuenta? <UiLink to="/register">Regístrate</UiLink>
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

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
    error.value = err?.data?.message || 'Email o contraseña incorrectos.'
  } finally {
    loading.value = false
  }
}
</script>
