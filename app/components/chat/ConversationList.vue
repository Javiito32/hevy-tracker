<template>
  <div class="flex flex-col h-full bg-slate-950/70">
    <div class="p-3 border-b border-slate-800">
      <button
        @click="emit('new')"
        class="w-full bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-3 py-2 rounded-lg transition flex items-center justify-center gap-2"
      >
        <span class="text-base leading-none">+</span> Nueva conversación
      </button>
    </div>

    <div class="flex-grow overflow-y-auto custom-scrollbar p-2 space-y-1">
      <p v-if="loading" class="text-xs text-slate-500 text-center py-4">Cargando…</p>
      <p v-else-if="!conversations.length" class="text-xs text-slate-600 text-center py-4 px-2">
        Aún no tienes conversaciones guardadas.
      </p>

      <div
        v-for="convo in conversations"
        :key="convo.id"
        :class="[
          'group rounded-lg px-3 py-2 cursor-pointer transition border',
          convo.id === activeId
            ? 'bg-violet-950/50 border-violet-800'
            : 'bg-transparent border-transparent hover:bg-slate-900'
        ]"
        @click="emit('select', convo.id)"
      >
        <!-- Inline rename -->
        <div v-if="renamingId === convo.id" class="flex items-center gap-1" @click.stop>
          <input
            ref="renameInput"
            v-model="renameDraft"
            class="flex-grow bg-slate-800 border border-violet-600 rounded px-2 py-1 text-xs text-slate-100 outline-none min-w-0"
            @keydown.enter.prevent="commitRename(convo.id)"
            @keydown.esc="cancelRename"
          />
          <button class="text-emerald-400 hover:text-emerald-300 text-xs px-1" title="Guardar" @click="commitRename(convo.id)">✓</button>
          <button class="text-slate-500 hover:text-slate-300 text-xs px-1" title="Cancelar" @click="cancelRename">✕</button>
        </div>

        <template v-else>
          <div class="flex items-start justify-between gap-1">
            <p
              :class="[
                'text-xs font-medium truncate flex-grow min-w-0',
                convo.id === activeId ? 'text-violet-200' : 'text-slate-300'
              ]"
            >
              {{ convo.title || 'Sin título' }}
            </p>
            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition flex-shrink-0" @click.stop>
              <button
                class="text-slate-500 hover:text-violet-400 text-[11px] px-1"
                title="Renombrar"
                @click="startRename(convo)"
              >✎</button>
              <button
                class="text-slate-500 hover:text-rose-400 text-[11px] px-1"
                title="Borrar"
                @click="emit('delete', convo.id)"
              >🗑</button>
            </div>
          </div>
          <p class="text-[10px] text-slate-600 truncate mt-0.5">{{ convo.preview }}</p>
          <p class="text-[10px] text-slate-700 mt-0.5">{{ formatDate(convo.updated_at) }}</p>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue'

export interface ConversationSummary {
  id: string
  title: string | null
  updated_at: string
  message_count: number
  preview: string
}

const props = defineProps<{
  conversations: ConversationSummary[]
  activeId: string | null
  loading?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  new: []
  delete: [id: string]
  rename: [id: string, title: string]
}>()

const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

const startRename = (convo: ConversationSummary) => {
  renamingId.value = convo.id
  renameDraft.value = convo.title ?? ''
  nextTick(() => renameInput.value?.focus())
}

const cancelRename = () => {
  renamingId.value = null
  renameDraft.value = ''
}

const commitRename = (id: string) => {
  const title = renameDraft.value.trim()
  // Unchanged or emptied: treat as a cancel rather than a pointless request.
  const current = props.conversations.find(c => c.id === id)?.title ?? ''
  if (title && title !== current) emit('rename', id, title)
  cancelRename()
}

const formatDate = (iso: string) => {
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(date)
}
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(100, 116, 139, 0.3);
  border-radius: 10px;
}
</style>
