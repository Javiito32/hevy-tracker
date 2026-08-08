<template>
  <div>
    <h1 class="font-display text-xl font-semibold tracking-tight text-ink">Crea tu cuenta</h1>
    <p class="text-sm text-ink-3 mt-1.5 mb-7">Conecta tu cuenta de Hevy y empieza a medir.</p>

    <form class="space-y-4" @submit.prevent="handleRegister">
      <UiField v-slot="{ id }" label="Nombre">
        <UiInput :id="id" v-model="form.name" type="text" required autocomplete="name" placeholder="Tu nombre" />
      </UiField>

      <UiField v-slot="{ id }" label="Email">
        <UiInput :id="id" v-model="form.email" type="email" required autocomplete="email" placeholder="tu@email.com" />
      </UiField>

      <UiField v-slot="{ id }" label="Contraseña" hint="Mínimo 8 caracteres.">
        <UiInput :id="id" v-model="form.password" type="password" required autocomplete="new-password" minlength="8" placeholder="••••••••" />
      </UiField>

      <p v-if="error" class="text-sm text-danger flex items-start gap-2 bg-danger/5 border border-danger/30 rounded-lg px-3 py-2.5">
        <span aria-hidden="true">⚠</span>{{ error }}
      </p>

      <UiButton type="submit" :loading="loading" block class="mt-2">
        {{ loading ? 'Creando cuenta…' : 'Crear cuenta' }}
      </UiButton>
    </form>

    <p class="text-sm text-ink-3 mt-7">
      ¿Ya tienes cuenta? <UiLink to="/login">Inicia sesión</UiLink>
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { fetch: refreshSession } = useUserSession()
const form = ref({ name: '', email: '', password: '' })
const loading = ref(false)
const error = ref('')

const handleRegister = async () => {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/auth/register', { method: 'POST', body: form.value })
    await refreshSession()
    await navigateTo('/')
  } catch (err: any) {
    error.value = err?.data?.message || 'No se pudo crear la cuenta. Inténtalo de nuevo.'
  } finally {
    loading.value = false
  }
}
</script>
