<template>
  <div class="max-w-2xl mx-auto">
    <h1 class="text-3xl font-bold mb-6 text-gray-800">Ajustes</h1>
    <div class="space-y-6">

      <!-- Perfil del deportista -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-xl font-semibold mb-4 border-b pb-2">Perfil del deportista</h2>
        <p class="text-xs text-gray-500 mb-4">Esta información se envía al coach de IA para personalizar el análisis.</p>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
            <input v-model="form.name" type="text"
              class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Tu nombre" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input v-model="form.email" type="email"
              class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="tu@email.com" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Fecha de nacimiento</label>
            <input v-model="form.birth_date" type="date"
              class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Altura (cm)</label>
            <input v-model.number="form.height" type="number" min="100" max="250"
              class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="175" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Sexo biológico</label>
            <select v-model="form.sex"
              class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Sin especificar</option>
              <option value="male">Masculino</option>
              <option value="female">Femenino</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Cambiar contraseña -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-xl font-semibold mb-1 border-b pb-2">Seguridad</h2>
        <p class="text-xs text-gray-500 mb-4">Deja los campos en blanco si no quieres cambiar la contraseña.</p>
        <div class="space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Contraseña actual</label>
            <input v-model="form.current_password" type="password" autocomplete="current-password"
              class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••" />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Nueva contraseña</label>
              <input v-model="form.new_password" type="password" autocomplete="new-password"
                class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Confirmar contraseña</label>
              <input v-model="form.confirm_password" type="password" autocomplete="new-password"
                class="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••" />
            </div>
          </div>
        </div>
      </div>

      <!-- Integración Hevy -->
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-xl font-semibold mb-4 border-b pb-2">Integración con Hevy</h2>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">API Key de Hevy</label>
          <div class="flex gap-2">
            <input v-model="form.hevy_api_key" :type="showHevyKey ? 'text' : 'password'"
              class="flex-grow border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Hevy Pro lifetime API Key" />
            <button type="button" @click="showHevyKey = !showHevyKey"
              class="px-3 py-2 border border-gray-300 rounded text-gray-500 hover:bg-gray-50 text-xs">
              {{ showHevyKey ? 'Ocultar' : 'Mostrar' }}
            </button>
          </div>
          <p class="text-xs text-gray-500 mt-1">
            Encuéntrala en el perfil de tu app de Hevy.
            <span v-if="(settings as any)?.has_hevy_key" class="text-green-600 font-medium ml-2">✓ Configurada</span>
          </p>
        </div>
      </div>

      <!-- IA (solo admin) -->
      <div v-if="isAdmin" class="bg-white rounded-lg shadow p-6">
        <h2 class="text-xl font-semibold mb-1 border-b pb-2">Configuración IA</h2>
        <p class="text-xs text-gray-500 mb-4">Clave compartida para todos los usuarios de la app.</p>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">API Key de OpenAI</label>
          <div class="flex gap-2">
            <input v-model="form.openai_api_key" :type="showOpenAIKey ? 'text' : 'password'"
              class="flex-grow border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="sk-..." />
            <button type="button" @click="showOpenAIKey = !showOpenAIKey"
              class="px-3 py-2 border border-gray-300 rounded text-gray-500 hover:bg-gray-50 text-xs">
              {{ showOpenAIKey ? 'Ocultar' : 'Mostrar' }}
            </button>
          </div>
          <p class="text-xs text-gray-500 mt-1">
            <span v-if="(settings as any)?.has_openai_key" class="text-green-600 font-medium">✓ Configurada</span>
            <span v-else>Necesaria para el AI Coach y análisis de entrenamientos.</span>
          </p>
        </div>
      </div>

      <!-- AI context preview -->
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center justify-between mb-3 border-b pb-2">
          <h2 class="text-xl font-semibold">Contexto enviado a la IA</h2>
          <button @click="refreshPreview" class="text-xs text-blue-600 hover:underline">Actualizar</button>
        </div>
        <p class="text-xs text-gray-500 mb-3">Esto es exactamente lo que verá el coach de IA sobre ti. Guarda los ajustes para que se refleje aquí.</p>
        <div v-if="previewLoading" class="text-sm text-gray-400">Cargando...</div>
        <pre v-else class="text-xs bg-gray-50 border border-gray-200 rounded p-3 whitespace-pre-wrap font-mono text-gray-700 leading-relaxed">{{ aiPreview }}</pre>
      </div>

      <!-- Feedback -->
      <div v-if="saveError" class="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{{ saveError }}</div>
      <div v-if="saveSuccess" class="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded text-sm">Ajustes guardados correctamente.</div>

      <div class="flex justify-end">
        <button @click="handleSave" :disabled="saving"
          class="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
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
const { session } = useUserSession()
const isAdmin = computed(() => (session.value?.user as any)?.role === 'admin')

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
  openai_api_key: '',
  current_password: '',
  new_password: '',
  confirm_password: '',
})
const showHevyKey = ref(false)
const showOpenAIKey = ref(false)
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
  form.value.openai_api_key = s.openai_api_key ?? ''
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
