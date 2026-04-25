<template>
  <div class="max-w-2xl mx-auto">
    <h1 class="text-3xl font-bold mb-6 text-slate-100">Ajustes</h1>
    <div class="space-y-6">

      <!-- Perfil del deportista -->
      <div class="bg-slate-900 rounded-xl border border-slate-800 p-6">
        <h2 class="text-lg font-semibold mb-1 text-slate-100 border-b border-slate-800 pb-3">Perfil del deportista</h2>
        <p class="text-xs text-slate-500 mb-4 mt-3">Esta información se envía al coach de IA para personalizar el análisis.</p>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1.5">Nombre</label>
            <input v-model="form.name" type="text"
              class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              placeholder="Tu nombre" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1.5">Email</label>
            <input v-model="form.email" type="email"
              class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              placeholder="tu@email.com" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1.5">Fecha de nacimiento</label>
            <input v-model="form.birth_date" type="date"
              class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1.5">Altura (cm)</label>
            <input v-model.number="form.height" type="number" min="100" max="250"
              class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              placeholder="175" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1.5">Sexo biológico</label>
            <select v-model="form.sex"
              class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition">
              <option value="">Sin especificar</option>
              <option value="male">Masculino</option>
              <option value="female">Femenino</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Cambiar contraseña -->
      <div class="bg-slate-900 rounded-xl border border-slate-800 p-6">
        <h2 class="text-lg font-semibold mb-1 text-slate-100 border-b border-slate-800 pb-3">Seguridad</h2>
        <p class="text-xs text-slate-500 mb-4 mt-3">Deja los campos en blanco si no quieres cambiar la contraseña.</p>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1.5">Contraseña actual</label>
            <input v-model="form.current_password" type="password" autocomplete="current-password"
              class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              placeholder="••••••••" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-400 mb-1.5">Nueva contraseña</label>
              <input v-model="form.new_password" type="password" autocomplete="new-password"
                class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                placeholder="••••••••" />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-400 mb-1.5">Confirmar contraseña</label>
              <input v-model="form.confirm_password" type="password" autocomplete="new-password"
                class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                placeholder="••••••••" />
            </div>
          </div>
        </div>
      </div>

      <!-- Integración Hevy -->
      <div class="bg-slate-900 rounded-xl border border-slate-800 p-6">
        <h2 class="text-lg font-semibold mb-4 text-slate-100 border-b border-slate-800 pb-3">Integración con Hevy</h2>
        <div class="mt-3">
          <label class="block text-sm font-medium text-slate-400 mb-1.5">API Key de Hevy</label>
          <div class="flex gap-2">
            <input v-model="form.hevy_api_key" :type="showHevyKey ? 'text' : 'password'"
              class="flex-grow bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
              placeholder="Hevy Pro lifetime API Key" />
            <button type="button" @click="showHevyKey = !showHevyKey"
              class="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-400 hover:bg-slate-700 text-xs transition">
              {{ showHevyKey ? 'Ocultar' : 'Mostrar' }}
            </button>
          </div>
          <p class="text-xs text-slate-500 mt-1">
            Encuéntrala en el perfil de tu app de Hevy.
            <span v-if="(settings as any)?.has_hevy_key" class="text-emerald-400 font-medium ml-2">✓ Configurada</span>
          </p>
        </div>
      </div>

      <!-- AI context preview -->
      <div class="bg-slate-900 rounded-xl border border-slate-800 p-6">
        <div class="flex items-center justify-between mb-3 border-b border-slate-800 pb-3">
          <h2 class="text-lg font-semibold text-slate-100">Contexto enviado a la IA</h2>
          <button @click="refreshPreview" class="text-xs text-indigo-400 hover:text-indigo-300 transition">Actualizar</button>
        </div>
        <p class="text-xs text-slate-500 mb-3 mt-2">Esto es exactamente lo que verá el coach de IA sobre ti. Guarda los ajustes para que se refleje aquí.</p>
        <div v-if="previewLoading" class="text-sm text-slate-500">Cargando...</div>
        <pre v-else class="text-xs bg-slate-800 border border-slate-700 rounded-lg p-3 whitespace-pre-wrap font-mono text-slate-400 leading-relaxed">{{ aiPreview }}</pre>
      </div>

      <!-- Feedback -->
      <div v-if="saveError" class="bg-rose-950/60 border border-rose-800 text-rose-400 px-4 py-3 rounded-lg text-sm">{{ saveError }}</div>
      <div v-if="saveSuccess" class="bg-emerald-950/60 border border-emerald-800 text-emerald-400 px-4 py-3 rounded-lg text-sm">Ajustes guardados correctamente.</div>

      <div class="flex justify-end">
        <button @click="handleSave" :disabled="saving"
          class="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2 transition">
          <svg v-if="saving" class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          {{ saving ? 'Guardando...' : 'Guardar Ajustes' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">

const { data: settings, refresh } = useFetch('/api/settings')
const { data: previewData, pending: previewLoading, refresh: refreshPreview } = useFetch('/api/settings/ai-preview')

const aiPreview = computed(() => (previewData.value as any)?.preview ?? '- Sin datos de perfil registrados.')

const form = ref({
  name: '',
  email: '',
  height: null as number | null,
  sex: '',
  birth_date: '',
  hevy_api_key: '',
  current_password: '',
  new_password: '',
  confirm_password: '',
})
const showHevyKey = ref(false)
const saving = ref(false)
const saveSuccess = ref(false)
const saveError = ref('')

watch(settings, (val) => {
  if (!val) return
  const s = val as any
  form.value.name = s.name ?? ''
  form.value.email = s.email ?? ''
  form.value.height = s.height ?? null
  form.value.sex = s.sex ?? ''
  form.value.birth_date = s.birth_date ?? ''
  form.value.hevy_api_key = s.hevy_api_key ?? ''
}, { immediate: true })

const handleSave = async () => {
  saveSuccess.value = false
  saveError.value = ''

  if (form.value.new_password && form.value.new_password !== form.value.confirm_password) {
    saveError.value = 'Las contraseñas nuevas no coinciden.'
    return
  }

  saving.value = true
  try {
    const { confirm_password, ...body } = form.value
    await $fetch('/api/settings', { method: 'POST', body })
    saveSuccess.value = true
    form.value.current_password = ''
    form.value.new_password = ''
    form.value.confirm_password = ''
    await Promise.all([refresh(), refreshPreview()])
    setTimeout(() => { saveSuccess.value = false }, 3000)
  } catch (err: any) {
    saveError.value = err?.data?.message || err?.data?.statusMessage || 'Error al guardar.'
  } finally {
    saving.value = false
  }
}
</script>
