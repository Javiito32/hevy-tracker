<template>
  <div v-if="data && data.users.length" class="bg-slate-900 rounded-xl border border-amber-900/40 overflow-hidden mb-8">
    <div class="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h2 class="text-lg font-semibold text-slate-100">Ejercicios sin clasificar</h2>
        <p class="text-xs text-slate-500 mt-1">
          Sus series no cuentan en ningún grupo muscular, así que rebajan todos los volúmenes semanales.
        </p>
      </div>
      <span class="text-xs bg-amber-950/60 text-amber-400 px-3 py-1.5 rounded-full font-semibold whitespace-nowrap">
        {{ data.total }} pendientes
      </span>
    </div>

    <div class="divide-y divide-slate-800">
      <div v-for="group in data.users" :key="group.user_id" class="px-6 py-4">
        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{{ group.user_name }}</p>

        <div class="space-y-2">
          <div
            v-for="ex in group.exercises"
            :key="ex.name"
            class="flex flex-wrap items-center gap-3 bg-slate-800/40 border border-slate-800 rounded-lg px-4 py-3"
          >
            <div class="min-w-0 flex-1">
              <p class="text-sm text-slate-200 truncate">{{ ex.name }}</p>
              <p class="text-xs text-slate-600">
                {{ ex.sessions }} {{ ex.sessions === 1 ? 'sesión' : 'sesiones' }} · última {{ formatDateShort(ex.last_date) }}
              </p>
            </div>

            <span
              v-if="ex.has_override"
              class="text-xs bg-emerald-950/60 text-emerald-400 border border-emerald-900 px-2 py-1 rounded whitespace-nowrap"
            >Asignado</span>

            <template v-else>
              <select
                v-model="assignments[key(group.user_id, ex.name)]"
                class="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition"
              >
                <option value="">Grupo muscular…</option>
                <option v-for="g in data.muscle_groups" :key="g.value" :value="g.value">{{ g.label }}</option>
              </select>
              <button
                @click="assign(group.user_id, ex.name)"
                :disabled="!assignments[key(group.user_id, ex.name)] || saving === key(group.user_id, ex.name)"
                class="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-500 disabled:opacity-40 transition whitespace-nowrap"
              >
                {{ saving === key(group.user_id, ex.name) ? 'Guardando…' : 'Asignar' }}
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <p class="px-6 py-3 border-t border-slate-800 text-xs text-slate-600">
      Tras asignar, vuelve a ejecutar «Recalcular métricas» no es necesario: el reparto por grupo muscular se resuelve en cada consulta.
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'

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
    alert(err?.data?.message ?? 'No se pudo asignar el grupo muscular.')
  } finally {
    saving.value = null
  }
}
</script>
