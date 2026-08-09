<template>
  <div class="max-w-5xl mx-auto">
    <NuxtLink to="/mesocycles" class="text-ink-3 hover:text-ink mb-4 inline-block transition">← Volver a Mesociclos</NuxtLink>

    <div v-if="pending" class="flex justify-center p-12">
      <UiSpinner size="lg" class="text-ink-3" />
    </div>

    <div v-else-if="mesocycle">
      <!-- Header -->
      <div class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div>
          <div class="flex items-center gap-3 mb-1">
            <h1 class="font-display text-2xl sm:text-[28px] font-semibold tracking-[-0.02em] text-ink leading-none">{{ mesocycle.name }}</h1>
            <span :class="statusBadge" class="text-xs font-semibold px-2.5 py-1 rounded-full capitalize">
              {{ statusLabel }}
            </span>
          </div>
          <p class="text-ink-3 text-sm">
            {{ formatDate(mesocycle.start_date) }}
            <span v-if="mesocycle.end_date"> → {{ formatDate(mesocycle.end_date) }}</span>
            <span v-else> → en curso</span>
            &bull; {{ mesocycle._count.workouts }} entrenamientos
          </p>
        </div>

        <div class="flex items-center gap-2 flex-wrap">
          <button
            v-if="mesocycle.status !== 'active'"
            @click="changeStatus('active')"
            :disabled="statusChanging"
            class="px-4 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 disabled:opacity-50 transition"
          >
            Activar
          </button>
          <button
            v-if="mesocycle.status === 'active'"
            @click="changeStatus('paused')"
            :disabled="statusChanging"
            class="px-4 py-2 bg-warn text-ink text-sm rounded-lg hover:bg-warn disabled:opacity-50 transition"
          >
            Pausar
          </button>
          <button
            v-if="mesocycle.status !== 'completed'"
            @click="changeStatus('completed')"
            :disabled="statusChanging"
            class="px-4 py-2 bg-surface-2 text-ink text-sm rounded-lg hover:bg-ink-3 disabled:opacity-50 transition"
          >
            Completar
          </button>
          <button
            @click="openEdit"
            class="px-4 py-2 bg-surface-2 border border-line-strong hover:border-ink-3 text-ink-2 text-sm rounded-lg transition"
          >
            Editar
          </button>
          <!-- Carries which block it is: the chat's system prompt only knows the
               active mesocycle, so a link from a paused one would silently
               discuss a different block. -->
          <NuxtLink
            :to="{ path: '/chat', query: { context: 'mesocycle', name: mesocycle.name } }"
            class="px-4 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 transition"
          >
            Hablar con IA
          </NuxtLink>
        </div>
      </div>

      <!-- Edit modal -->
      <div v-if="showEditModal" class="fixed inset-0 bg-bg/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4" @click.self="showEditModal = false">
        <div class="bg-surface border border-line-strong rounded-card w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
          <h2 class="text-lg font-bold text-ink mb-5">Editar mesociclo</h2>
          <form @submit.prevent="saveMesocycle" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-ink-2 mb-1.5">Nombre *</label>
              <input v-model="editForm.name" type="text" required class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-ink-2 mb-1.5">Fecha inicio *</label>
                <input v-model="editForm.start_date" type="date" required class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
              </div>
              <div>
                <label class="block text-sm font-medium text-ink-2 mb-1.5">Fecha fin</label>
                <input v-model="editForm.end_date" type="date" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-2 mb-1.5">Objetivo</label>
              <textarea v-model="editForm.goal" rows="2" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" placeholder="¿Qué quieres lograr en este mesociclo?"></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-2 mb-1.5">Split / Rutina</label>
              <textarea v-model="editForm.split_description" rows="3" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm font-mono text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" placeholder="Ej: Lun: Pecho/Tríceps&#10;Mar: Espalda/Bíceps&#10;..."></textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-2 mb-1.5">Objetivo de entrenamientos/semana</label>
              <input v-model.number="editForm.target_sessions_weekly" type="number" min="1" max="14" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition" />
            </div>
            <div>
              <label class="block text-sm font-medium text-ink-2 mb-1.5">Notas generales</label>
              <textarea v-model="editForm.notes" rows="2" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent transition"></textarea>
            </div>
            <div class="flex justify-end gap-3 pt-2">
              <button type="button" @click="showEditModal = false" class="px-4 py-2 text-sm text-ink-2 hover:text-ink transition">Cancelar</button>
              <button type="submit" :disabled="savingEdit" class="px-4 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 disabled:opacity-50 transition">
                {{ savingEdit ? 'Guardando...' : 'Guardar cambios' }}
              </button>
            </div>
          </form>

          <!-- Destructive zone. Two steps, and the second one names what
               survives: the fear when deleting a block is losing the training,
               and the training is exactly what is kept. -->
          <div class="mt-6 pt-5 border-t border-line">
            <template v-if="!confirmingDelete">
              <div class="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p class="text-sm font-medium text-ink">Eliminar mesociclo</p>
                  <p class="text-xs text-ink-3 mt-0.5">Se borra el plan, las evaluaciones y las notas del bloque.</p>
                </div>
                <UiButton size="sm" variant="danger" @click="confirmingDelete = true">Eliminar</UiButton>
              </div>
            </template>

            <div v-else class="bg-danger/5 border border-danger/40 rounded-card p-4">
              <p class="text-sm font-medium text-danger">¿Eliminar «{{ mesocycle.name }}»?</p>
              <ul class="text-xs text-ink-2 mt-2 space-y-1 list-disc pl-4">
                <li>Se eliminan la rutina, las {{ evaluations?.length ?? 0 }} evaluaciones semanales y las notas del bloque.</li>
                <li><strong>Tus entrenamientos no se borran.</strong> Los {{ mesocycle.workouts?.length ?? 0 }} registrados durante el bloque siguen en tu historial, solo dejan de estar asociados a él.</li>
                <li>Las rutinas ya enviadas a Hevy siguen en tu cuenta de Hevy; bórralas allí si quieres.</li>
              </ul>
              <p class="text-xs text-ink-3 mt-3">Esto no se puede deshacer.</p>
              <div class="flex justify-end gap-3 mt-4">
                <UiButton size="sm" variant="ghost" :disabled="deleting" @click="confirmingDelete = false">Cancelar</UiButton>
                <UiButton size="sm" variant="danger" :loading="deleting" @click="deleteMesocycle">Sí, eliminar</UiButton>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- The plan: what to do next, and whether the block is being followed. -->
      <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <p class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3">Rutina</p>
          <p class="text-xs text-ink-3 mt-0.5">La prescripción estructurada: lo que se envía a Hevy.</p>
        </div>
        <UiButton size="sm" variant="secondary" @click="showPlanEditor = true">
          {{ plan?.has_plan ? 'Editar rutina' : 'Crear rutina' }}
        </UiButton>
      </div>

      <div v-if="nextSession?.has_plan" class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <MesocycleNextSession :data="nextSession" @push="pushToHevy" />
        <MesocyclePlanAdherence :adherence="plan?.adherence" />
      </div>

      <!-- Without this, a block with no structured plan showed nothing at all
           here and there was no way in to build one. -->
      <div v-else class="bg-surface border border-line rounded-card mb-6">
        <UiEmptyState
          title="Este bloque no tiene rutina estructurada"
          description="Sin sesiones y ejercicios prescritos no hay próxima sesión, ni adherencia, ni nada que enviar a Hevy."
        >
          <UiButton size="sm" variant="secondary" @click="showPlanEditor = true">Crear rutina</UiButton>
        </UiEmptyState>
      </div>

      <MesocyclePlanEditor
        :open="showPlanEditor"
        :mesocycle-id="mesocycleId"
        :plan="plan"
        @close="showPlanEditor = false"
        @saved="onPlanSaved"
      />

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left column: info + workouts list -->
        <div class="lg:col-span-2 space-y-6">
          <!-- Stats row -->
          <div class="grid grid-cols-3 gap-4">
            <div class="bg-surface rounded-card border border-line border-t-4 border-t-indigo-500 p-4">
              <p class="text-xs text-ink-3 uppercase tracking-wide mb-1">Entrenamientos</p>
              <p class="text-2xl font-bold text-ink">{{ mesocycle._count.workouts }}</p>
            </div>
            <div class="bg-surface rounded-card border border-line border-t-4 border-t-emerald-500 p-4">
              <p class="text-xs text-ink-3 uppercase tracking-wide mb-1">Volumen total</p>
              <p class="text-2xl font-bold text-ink">{{ totalVolume.toLocaleString() }}<span class="text-sm font-normal text-ink-3 ml-1">kg</span></p>
            </div>
            <div class="bg-surface rounded-card border border-line border-t-4 border-t-violet-500 p-4">
              <p class="text-xs text-ink-3 uppercase tracking-wide mb-1">RPE promedio</p>
              <p class="text-2xl font-bold text-ink">{{ avgRpe || 'N/A' }}</p>
            </div>
          </div>

          <!-- Workouts list -->
          <div class="bg-surface rounded-card border border-line overflow-hidden">
            <div class="px-5 py-3.5 border-b border-line">
              <h2 class="font-display text-sm font-semibold tracking-tight text-ink">Entrenamientos</h2>
            </div>
            <div v-if="mesocycle.workouts.length === 0" class="p-6 text-ink-3 text-sm">
              No hay entrenamientos asignados a este mesociclo todavía.
            </div>
            <div v-else class="divide-y divide-line">
              <NuxtLink
                v-for="workout in mesocycle.workouts"
                :key="workout.id"
                :to="`/workouts/${workout.id}`"
                class="flex items-center justify-between px-6 py-4 hover:bg-surface-2/50 transition"
              >
                <div>
                  <p class="font-medium text-ink">{{ workout.name }}</p>
                  <p class="text-sm text-ink-3">{{ formatDate(workout.date) }} &bull; {{ formatDuration(workout.duration) }}</p>
                </div>
                <div class="text-right text-sm text-ink-3">
                  <p v-if="workout.total_volume">{{ workout.total_volume.toLocaleString() }} kg</p>
                  <p v-if="workout.rpe_avg" class="text-xs">RPE {{ workout.rpe_avg }}</p>
                </div>
              </NuxtLink>
            </div>
          </div>
        </div>

        <!-- Right column: details panel -->
        <div class="space-y-6">
          <div class="bg-surface rounded-card border border-line p-6">
            <h2 class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-3">Objetivo</h2>
            <p class="text-sm text-ink-2 whitespace-pre-wrap" v-if="mesocycle.goal">{{ mesocycle.goal }}</p>
            <p class="text-sm text-ink-3 italic" v-else>Sin objetivo definido.</p>
          </div>

          <div class="bg-surface rounded-card border border-line p-6">
            <h2 class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-3">Split / Rutina</h2>
            <p class="text-sm text-ink-2 whitespace-pre-wrap font-mono" v-if="mesocycle.split_description">{{ mesocycle.split_description }}</p>
            <p class="text-sm text-ink-3 italic" v-else>Sin descripción de split.</p>
          </div>

          <div class="bg-surface rounded-card border border-line p-6" v-if="mesocycle.notes">
            <h2 class="font-display text-[10px] font-semibold uppercase tracking-eyebrow text-ink-3 mb-3">Notas</h2>
            <p class="text-sm text-ink-2 whitespace-pre-wrap">{{ mesocycle.notes }}</p>
          </div>
        </div>
      </div>

      <!-- Evaluaciones semanales -->
      <div class="mt-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold text-ink">Evaluaciones semanales</h2>
          <button
            @click="triggerEvaluation"
            :disabled="evaluating"
            class="px-4 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 disabled:opacity-50 flex items-center gap-2 transition"
          >
            <svg v-if="evaluating" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            {{ evaluating ? 'Generando...' : '✨ Evaluar semana actual' }}
          </button>
        </div>

        <div v-if="evalError" class="bg-danger/10 border border-danger/40 text-danger text-sm px-4 py-3 rounded-lg mb-4">
          {{ evalError }}
        </div>

        <div v-if="evalsLoading" class="text-center py-6 text-ink-3 text-sm">Cargando evaluaciones...</div>

        <div v-else-if="!evaluations?.length" class="bg-surface rounded-card border border-line p-8 text-center text-ink-3">
          <p class="text-sm">Sin evaluaciones todavía. Genera la primera con el botón de arriba.</p>
        </div>

        <div v-else class="space-y-4">
          <div
            v-for="ev in evaluations"
            :key="ev.id"
            class="bg-surface rounded-card border border-line overflow-hidden"
          >
            <div
              class="flex items-center justify-between px-6 py-3 bg-surface-2 border-b border-line-strong cursor-pointer"
              @click="toggleEval(ev.id)"
            >
              <div class="flex items-center gap-3">
                <span class="bg-accent text-accent-ink text-xs font-bold px-2 py-0.5 rounded">S{{ ev.week_number }}</span>
                <span class="text-sm font-medium text-ink-2">
                  {{ new Date(ev.evaluation_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) }}
                </span>
                <span
                  v-if="ev.volume_trend"
                  class="text-xs px-2 py-0.5 rounded-full"
                  :class="{
                    'bg-positive/10 text-positive': ev.volume_trend === 'increasing',
                    'bg-warn/10 text-warn': ev.volume_trend === 'stable',
                    'bg-danger/10 text-danger': ev.volume_trend === 'decreasing',
                    'bg-surface-2 text-ink-3': ev.volume_trend === 'N/A'
                  }"
                >
                  {{ ev.volume_trend === 'increasing' ? '↑ Volumen' : ev.volume_trend === 'decreasing' ? '↓ Volumen' : '→ Estable' }}
                </span>
              </div>
              <span class="text-ink-3 text-xs">{{ expandedEvals.has(ev.id) ? '▲' : '▼' }}</span>
            </div>

            <div v-if="expandedEvals.has(ev.id)" class="px-6 py-4">
              <div
                class="md"
                v-html="renderMarkdown(ev.ai_analysis ?? '')"
              ></div>
              <p v-if="isAdmin && (ev as any).ai_model" class="text-[10px] font-mono text-ink-3 mt-2">Modelo: {{ (ev as any).ai_model }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Diario de notas -->
      <div class="mt-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold text-ink">Diario</h2>
          <button
            @click="showNoteForm = !showNoteForm"
            class="px-4 py-2 bg-surface-2 text-ink text-sm rounded-lg flex items-center gap-1.5 transition"
          >
            <span>+ Añadir nota</span>
          </button>
        </div>

        <!-- Note form -->
        <div v-if="showNoteForm" class="bg-surface rounded-card border border-line p-5 mb-4">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
            <div>
              <label class="block text-xs font-medium text-ink-3 mb-1">Fecha</label>
              <input v-model="noteForm.date" type="date" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:border-line-strong focus:border-transparent transition" />
            </div>
            <div class="sm:col-span-2">
              <label class="block text-xs font-medium text-ink-3 mb-1">Etiquetas (separadas por coma)</label>
              <input v-model="noteForm.tagsRaw" type="text" placeholder="ej: fatiga, sueño, nutrición" class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-1.5 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:border-line-strong focus:border-transparent transition" />
            </div>
          </div>
          <textarea
            v-model="noteForm.content"
            rows="3"
            placeholder="Sensaciones del entrenamiento, cambios en dieta, calidad del sueño, nivel de estrés..."
            class="w-full bg-surface-2 border border-line-strong hover:border-ink-3 rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:border-line-strong focus:border-transparent mb-3 transition"
          ></textarea>
          <div class="flex justify-end gap-3">
            <button @click="showNoteForm = false; resetNoteForm()" class="text-sm text-ink-3 hover:text-ink-2 transition">Cancelar</button>
            <button @click="saveNote" :disabled="savingNote || !noteForm.content.trim()" class="px-4 py-1.5 bg-surface-2 text-ink text-sm rounded-lg disabled:opacity-50 transition">
              {{ savingNote ? 'Guardando...' : 'Guardar nota' }}
            </button>
          </div>
        </div>

        <div v-if="notesLoading" class="text-center py-6 text-ink-3 text-sm">Cargando notas...</div>

        <div v-else-if="!notes?.length" class="bg-surface rounded-card border border-line p-8 text-center text-ink-3">
          <p class="text-sm">Sin notas todavía. Registra tus sensaciones, cambios en rutina o en dieta.</p>
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="note in notes"
            :key="note.id"
            class="bg-surface rounded-card border border-line px-5 py-4 flex gap-4"
          >
            <div class="flex-shrink-0 text-center">
              <p class="text-xs font-bold text-ink-2 uppercase">{{ noteDayMonth(note.date) }}</p>
              <p class="text-lg font-bold text-ink leading-none">{{ noteDay(note.date) }}</p>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-ink-2 whitespace-pre-wrap">{{ note.content }}</p>
              <div v-if="noteTags(note.tags).length" class="flex flex-wrap gap-1 mt-2">
                <span
                  v-for="tag in noteTags(note.tags)"
                  :key="tag"
                  class="text-xs bg-surface-2/60 text-ink-2 border border-line-strong px-2 py-0.5 rounded-full"
                >{{ tag }}</span>
              </div>
            </div>
            <button @click="deleteNote(note.id)" class="text-ink-3 hover:text-danger text-lg self-start flex-shrink-0 transition">×</button>
          </div>
        </div>
      </div>

      <!-- Resumen final del mesociclo -->
      <div v-if="mesocycle.status === 'completed'" class="mt-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-semibold text-ink">Resumen final</h2>
          <button
            v-if="!mesocycle.final_summary"
            @click="generateFinalSummary"
            :disabled="generatingSummary"
            class="px-4 py-2 bg-accent text-accent-ink text-sm rounded-lg hover:opacity-85 disabled:opacity-50 flex items-center gap-2 transition"
          >
            <svg v-if="generatingSummary" class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            {{ generatingSummary ? 'Generando...' : '✨ Generar resumen final' }}
          </button>
          <button
            v-else
            @click="generateFinalSummary"
            :disabled="generatingSummary"
            class="text-xs text-ink-3 hover:text-ink-2 disabled:opacity-50 transition"
          >
            {{ generatingSummary ? 'Regenerando...' : 'Regenerar' }}
          </button>
        </div>

        <div v-if="summaryError" class="bg-danger/10 border border-danger/40 text-danger text-sm px-4 py-3 rounded-lg mb-4">
          {{ summaryError }}
        </div>

        <div v-if="mesocycle.final_summary" class="bg-surface-2 border border-line rounded-card p-6">
          <div class="md" v-html="renderMarkdown(mesocycle.final_summary)"></div>
          <p v-if="isAdmin && displayedSummaryModel" class="text-[10px] font-mono text-ink-3 mt-2">Modelo: {{ displayedSummaryModel }}</p>
        </div>
        <div v-else-if="!generatingSummary" class="bg-surface rounded-card border border-line p-8 text-center text-ink-3">
          <p class="text-sm">El resumen final se genera automáticamente al completar el mesociclo, o puedes generarlo manualmente con el botón de arriba.</p>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-12">
      <p class="text-ink-3">Mesociclo no encontrado.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const mesocycleId = route.params.id as string

const { session } = useUserSession()
const isAdmin = computed(() => (session.value?.user as any)?.role === 'admin')

const toast = useToast()

const { data: mesocycle, pending, refresh } = useFetch(`/api/mesocycles/${mesocycleId}`)
const { data: plan, refresh: refreshPlan } = useFetch<any>(`/api/mesocycles/${mesocycleId}/plan`)
const { data: nextSession, refresh: refreshNext } = useFetch<any>(`/api/mesocycles/${mesocycleId}/next-session`)

/**
 * Writes the block's routines into the athlete's Hevy account, so it always
 * asks first — it changes data in an app outside this one.
 */
const pushToHevy = async () => {
  const alreadyPushed = plan.value?.sessions?.some((s: any) => s.hevy_routine_id)
  const question = alreadyPushed
    ? '¿Actualizar en Hevy las rutinas de este mesociclo con las cargas de esta semana?'
    : '¿Crear en tu cuenta de Hevy una carpeta con las rutinas de este mesociclo?'
  if (!confirm(question)) return

  try {
    const res = await $fetch<{ message: string }>(`/api/mesocycles/${mesocycleId}/push-to-hevy`, { method: 'POST' })
    toast.success(res.message)
    await Promise.all([refreshPlan(), refreshNext()])
  } catch (err: any) {
    toast.error(err?.data?.message ?? 'No se pudieron enviar las rutinas a Hevy.')
  }
}
const { data: evaluations, pending: evalsLoading, refresh: refreshEvals } = useFetch(`/api/mesocycles/${mesocycleId}/evaluations`)
const { data: notes, pending: notesLoading, refresh: refreshNotes } = useFetch(`/api/mesocycles/${mesocycleId}/notes`)

/**
 * The plan the editor just wrote is what three of this page's cards are drawn
 * from, and `savePlan` derives `split_description` / `target_sessions_weekly`
 * onto the mesocycle itself — so the block row is refreshed too, not just the plan.
 */
const showPlanEditor = ref(false)
const onPlanSaved = async () => {
  await Promise.all([refresh(), refreshPlan(), refreshNext()])
}

const statusChanging = ref(false)
const showEditModal = ref(false)
const savingEdit = ref(false)
const editForm = ref({ name: '', start_date: '', end_date: '', goal: '', split_description: '', target_sessions_weekly: 4, notes: '' })

const openEdit = () => {
  const m = mesocycle.value as any
  editForm.value = {
    name: m.name ?? '',
    start_date: m.start_date ? m.start_date.slice(0, 10) : '',
    end_date: m.end_date ? m.end_date.slice(0, 10) : '',
    goal: m.goal ?? '',
    split_description: m.split_description ?? '',
    target_sessions_weekly: m.target_sessions_weekly ?? 4,
    notes: m.notes ?? ''
  }
  // Reopening the dialog must not reopen it on the armed confirmation.
  confirmingDelete.value = false
  showEditModal.value = true
}

const saveMesocycle = async () => {
  savingEdit.value = true
  try {
    await $fetch(`/api/mesocycles/${mesocycleId}`, {
      method: 'PATCH',
      body: {
        ...editForm.value,
        end_date: editForm.value.end_date || null
      }
    })
    await refresh()
    showEditModal.value = false
  } catch (err: any) {
    toast.error(err?.data?.message ?? 'No se pudieron guardar los cambios.')
  } finally {
    savingEdit.value = false
  }
}

const confirmingDelete = ref(false)
const deleting = ref(false)

/**
 * Two-step, in-dialog. Not `confirm()`: the thing worth saying here is what
 * survives the delete, and a native dialog can only carry one line of text.
 */
const deleteMesocycle = async () => {
  deleting.value = true
  try {
    const res = await $fetch<{ workouts_kept: number }>(`/api/mesocycles/${mesocycleId}`, { method: 'DELETE' })
    showEditModal.value = false
    toast.success(
      res.workouts_kept
        ? `Mesociclo eliminado. Tus ${res.workouts_kept} entrenamientos siguen en el historial.`
        : 'Mesociclo eliminado.'
    )
    await navigateTo('/mesocycles')
  } catch (err: any) {
    toast.error(err?.data?.message ?? 'No se pudo eliminar el mesociclo.')
    deleting.value = false
  }
}

const evaluating = ref(false)
const evalError = ref<string | null>(null)
const expandedEvals = ref(new Set<string>())
const showNoteForm = ref(false)
const savingNote = ref(false)
const noteForm = ref({ date: new Date().toISOString().slice(0, 10), content: '', tagsRaw: '' })
const generatingSummary = ref(false)
const summaryError = ref<string | null>(null)
const freshSummaryModel = ref('')
const displayedSummaryModel = computed(() =>
  freshSummaryModel.value || (mesocycle.value as any)?.final_summary_model || ''
)

const generateFinalSummary = async () => {
  generatingSummary.value = true
  summaryError.value = null
  try {
    const res = await $fetch<{ success: boolean; final_summary: string; model: string }>(`/api/mesocycles/${mesocycleId}/final-summary`, { method: 'POST' })
    freshSummaryModel.value = res.model ?? ''
    await refresh()
  } catch (err: any) {
    summaryError.value = err?.data?.message ?? err?.message ?? 'Error al generar el resumen final.'
  } finally {
    generatingSummary.value = false
  }
}

const statusLabel = computed(() => {
  const map: Record<string, string> = { active: 'Activo', paused: 'Pausado', completed: 'Completado' }
  return map[mesocycle.value?.status ?? ''] ?? mesocycle.value?.status ?? ''
})

const statusBadge = computed(() => {
  const map: Record<string, string> = {
    active: 'bg-positive/10 text-positive',
    paused: 'bg-warn/10 text-warn',
    completed: 'bg-surface-2 text-ink-2'
  }
  return map[mesocycle.value?.status ?? ''] ?? 'bg-surface-2 text-ink-2'
})

const totalVolume = computed(() => {
  if (!mesocycle.value?.workouts) return 0
  return mesocycle.value.workouts.reduce((sum: number, w: any) => sum + (w.total_volume ?? 0), 0)
})

const avgRpe = computed(() => {
  if (!mesocycle.value?.workouts?.length) return null
  const workoutsWithRpe = mesocycle.value.workouts.filter((w: any) => w.rpe_avg)
  if (!workoutsWithRpe.length) return null
  const avg = workoutsWithRpe.reduce((sum: number, w: any) => sum + w.rpe_avg, 0) / workoutsWithRpe.length
  return avg.toFixed(1)
})

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
}

const formatDuration = (seconds?: number | null) => {
  if (!seconds) return 'N/A'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

const changeStatus = async (newStatus: string) => {
  statusChanging.value = true
  try {
    await $fetch(`/api/mesocycles/${mesocycleId}`, {
      method: 'PATCH',
      body: { status: newStatus }
    })
    await refresh()
  } finally {
    statusChanging.value = false
  }
}

const triggerEvaluation = async () => {
  evaluating.value = true
  evalError.value = null
  try {
    const result = await $fetch(`/api/mesocycles/${mesocycleId}/evaluate`, { method: 'POST' }) as any
    await refreshEvals()
    if (result?.id) {
      expandedEvals.value = new Set([result.id, ...expandedEvals.value])
    }
  } catch (err: any) {
    evalError.value = err?.data?.message ?? err?.message ?? 'Error al generar la evaluación.'
  } finally {
    evaluating.value = false
  }
}

const toggleEval = (id: string) => {
  const next = new Set(expandedEvals.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedEvals.value = next
}

const resetNoteForm = () => {
  noteForm.value = { date: new Date().toISOString().slice(0, 10), content: '', tagsRaw: '' }
}

const saveNote = async () => {
  if (!noteForm.value.content.trim()) return
  savingNote.value = true
  try {
    const tags = noteForm.value.tagsRaw
      ? noteForm.value.tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
      : []
    await $fetch(`/api/mesocycles/${mesocycleId}/notes`, {
      method: 'POST',
      body: { content: noteForm.value.content, date: noteForm.value.date, tags }
    })
    await refreshNotes()
    showNoteForm.value = false
    resetNoteForm()
  } finally {
    savingNote.value = false
  }
}

const deleteNote = async (noteId: string) => {
  if (!confirm('¿Eliminar esta nota?')) return
  await $fetch(`/api/mesocycles/${mesocycleId}/notes/${noteId}`, { method: 'DELETE' })
  await refreshNotes()
}

const noteTags = (tagsJson?: string | null): string[] => {
  if (!tagsJson) return []
  try { return JSON.parse(tagsJson) } catch { return [] }
}

const noteDay = (d: string) => new Date(d).getDate()
const noteDayMonth = (d: string) =>
  new Date(d).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')

// renderMarkdown comes from app/utils/markdown.ts (auto-imported).
</script>
