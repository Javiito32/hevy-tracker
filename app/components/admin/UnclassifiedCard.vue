<template>
  <div v-if="data && data.users.length" class="bg-surface rounded-card border border-warn/40 overflow-hidden mb-8">
    <div class="px-5 py-3.5 border-b border-line flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Ejercicios sin clasificar</h2>
        <p class="text-xs text-ink-3 mt-1">
          Sus series no cuentan en ningún grupo muscular, así que rebajan todos los volúmenes semanales.
        </p>
      </div>
      <span class="text-xs bg-warn/10 text-warn px-3 py-1.5 rounded-full font-semibold whitespace-nowrap">
        {{ data.total }} pendientes
      </span>
    </div>

    <div class="divide-y divide-line">
      <div v-for="group in data.users" :key="group.user_id" class="px-6 py-4">
        <p class="text-xs font-semibold text-ink-3 uppercase tracking-wide mb-3">{{ group.user_name }}</p>

        <div class="space-y-2">
          <div
            v-for="ex in group.exercises"
            :key="ex.name"
            class="flex flex-wrap items-center gap-3 bg-surface-2/40 border border-line rounded-lg px-4 py-3"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm text-ink truncate">{{ ex.name }}</p>
              <p class="text-xs text-ink-3">
                {{ ex.sessions }} {{ ex.sessions === 1 ? 'sesión' : 'sesiones' }} · última {{ formatDateShort(ex.last_date) }}
              </p>
            </div>

            <span
              v-if="ex.has_override"
              class="text-xs bg-positive/10 text-positive border border-positive/40 px-2 py-1 rounded whitespace-nowrap"
            >Asignado</span>

            <template v-else>
              <select
                v-model="assignments[key(group.user_id, ex.name)]"
                class="bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-focus transition"
              >
                <option value="">Grupo muscular…</option>
                <option v-for="g in data.muscle_groups" :key="g.value" :value="g.value">{{ g.label }}</option>
              </select>
              <button
                @click="assign(group.user_id, ex.name)"
                :disabled="!assignments[key(group.user_id, ex.name)] || saving === key(group.user_id, ex.name)"
                class="text-xs bg-accent text-accent-ink px-3 py-1.5 rounded-lg hover:opacity-85 disabled:opacity-40 transition whitespace-nowrap"
              >
                {{ saving === key(group.user_id, ex.name) ? 'Guardando…' : 'Asignar' }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <p class="px-6 py-3 border-t border-line text-xs text-ink-3">
      Tras asignar, vuelve a ejecutar «Recalcular métricas» no es necesario: el reparto por grupo muscular se resuelve en cada consulta.
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'

const toast = useToast()

interface Unclassified {
  users: Array<{
    user_id: string
    user_name: string
    exercises: Array<{ name: string; sessions: number; last_date: string; has_override: boolean }>
  }>
  muscle_groups: Array<{ value: string; label: string }>
  total: number
}

const { data, refresh } = useFetch<Unclassified>('/api/admin/unclassified')

/** Keyed by user+name because the same exercise name can be unresolved for several users. */
const key = (userId: string, name: string) => `${userId}::${name}`
const assignments = reactive<Record<string, string>>({})
const saving = ref<string | null>(null)

const assign = async (userId: string, name: string) => {
  const k = key(userId, name)
  const primary = assignments[k]
  if (!primary) return

  saving.value = k
  try {
    await $fetch('/api/admin/unclassified', {
      method: 'POST',
      body: { userId, exerciseName: name, primary }
    })
    await refresh()
  } catch (err: any) {
    toast.error(err?.data?.message ?? 'No se pudo asignar el grupo muscular.')
  } finally {
    saving.value = null
  }
}
</script>
