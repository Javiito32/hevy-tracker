<template>
  <div class="max-w-2xl mx-auto">
    <UiPageHeader title="Ajustes" />

    <div class="space-y-4">
      <UiCard
        eyebrow="Perfil"
        title="Perfil del deportista"
        hint="Esta información se envía al coach de IA para personalizar el análisis."
      >
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UiField v-slot="{ id }" label="Nombre">
            <UiInput :id="id" v-model="form.name" placeholder="Tu nombre" />
          </UiField>
          <UiField v-slot="{ id }" label="Email">
            <UiInput :id="id" v-model="form.email" type="email" placeholder="tu@email.com" />
          </UiField>
          <UiField v-slot="{ id }" label="Fecha de nacimiento">
            <UiInput :id="id" v-model="form.birth_date" type="date" />
          </UiField>
          <UiField v-slot="{ id }" label="Altura" unit="cm">
            <UiInput :id="id" v-model.number="form.height" type="number" min="100" max="250" placeholder="175" />
          </UiField>
          <UiField v-slot="{ id }" label="Sexo biológico">
            <UiSelect :id="id" v-model="form.sex">
              <option value="">Sin especificar</option>
              <option value="male">Masculino</option>
              <option value="female">Femenino</option>
            </UiSelect>
          </UiField>
          <div class="sm:col-span-2">
            <UiField
              v-slot="{ id }"
              label="Lesiones y limitaciones"
              hint="El coach las trata como restricción dura al recomendar ejercicios. Si está vacío, no puede respetarlas."
            >
              <UiInput
                :id="id"
                v-model="form.injuries_notes"
                type="textarea"
                :rows="3"
                placeholder="Ej: tendinopatía en hombro derecho, evitar press por encima de la cabeza."
              />
            </UiField>
          </div>
        </div>
      </UiCard>

      <UiCard
        eyebrow="Cuenta"
        title="Seguridad"
        hint="Deja los campos en blanco si no quieres cambiar la contraseña."
      >
        <div class="space-y-4">
          <UiField v-slot="{ id }" label="Contraseña actual">
            <UiInput :id="id" v-model="form.current_password" type="password" autocomplete="current-password" placeholder="••••••••" />
          </UiField>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UiField v-slot="{ id }" label="Nueva contraseña">
              <UiInput :id="id" v-model="form.new_password" type="password" autocomplete="new-password" placeholder="••••••••" />
            </UiField>
            <UiField v-slot="{ id }" label="Confirmar contraseña">
              <UiInput :id="id" v-model="form.confirm_password" type="password" autocomplete="new-password" placeholder="••••••••" />
            </UiField>
          </div>
        </div>
      </UiCard>

      <UiCard eyebrow="Integración" title="Hevy">
        <UiField
          v-slot="{ id }"
          label="API Key de Hevy"
          hint="Encuéntrala en el perfil de tu app de Hevy."
        >
          <div class="flex gap-2">
            <UiInput
              :id="id"
              v-model="form.hevy_api_key"
              :type="showHevyKey ? 'text' : 'password'"
              placeholder="Hevy Pro lifetime API Key"
            />
            <UiButton variant="secondary" size="sm" class="flex-shrink-0" @click="showHevyKey = !showHevyKey">
              {{ showHevyKey ? 'Ocultar' : 'Mostrar' }}
            </UiButton>
          </div>
        </UiField>
        <p v-if="(settings as any)?.has_hevy_key" class="text-xs text-positive flex items-center gap-1 mt-2">
          <span aria-hidden="true">✓</span>Configurada
        </p>
      </UiCard>

      <UiCard
        eyebrow="Coach"
        title="Contexto enviado a la IA"
        hint="Esto es exactamente lo que verá el coach sobre ti. Guarda los ajustes para que se refleje aquí."
      >
        <template #actions>
          <UiButton size="sm" variant="ghost" @click="refreshPreview">Actualizar</UiButton>
        </template>
        <p v-if="previewLoading" class="text-sm text-ink-3">Cargando…</p>
        <pre
          v-else
          class="font-data text-xs bg-surface-2 border border-line rounded-lg p-3 whitespace-pre-wrap text-ink-2 leading-relaxed overflow-x-auto"
        >{{ aiPreview }}</pre>
      </UiCard>

      <p v-if="saveError" class="text-sm text-danger flex items-start gap-2 bg-danger/5 border border-danger/30 px-4 py-3 rounded-lg">
        <span aria-hidden="true">⚠</span>{{ saveError }}
      </p>
      <p v-if="saveSuccess" class="text-sm text-positive flex items-start gap-2 bg-positive/5 border border-positive/30 px-4 py-3 rounded-lg">
        <span aria-hidden="true">✓</span>Ajustes guardados.
      </p>

      <div class="flex justify-end pt-1">
        <UiButton :loading="saving" @click="handleSave">
          {{ saving ? 'Guardando…' : 'Guardar ajustes' }}
        </UiButton>
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
  injuries_notes: '',
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
  form.value.injuries_notes = s.injuries_notes ?? ''
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
