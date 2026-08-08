<template>
  <div>
    <!--
      The camera is progressive enhancement only. BarcodeDetector needs a secure
      context (getUserMedia) and doesn't exist in Firefox or Safari, and this app
      is typically served over plain HTTP on a LAN — so manual entry is the
      primary path and lives in the parent component, always visible.
    -->
    <div v-if="!supported" class="text-xs text-slate-600">
      El escaneo con cámara no está disponible en este navegador
      <span v-if="!secure">porque la página no se sirve por HTTPS</span>. Escribe el código a mano.
    </div>

    <div v-else>
      <button
        v-if="!scanning"
        type="button"
        @click="start"
        class="w-full bg-slate-800 border border-slate-700 text-slate-300 px-4 py-2 rounded-lg hover:bg-slate-700 transition text-sm flex items-center justify-center gap-2"
      >
        📷 Escanear con la cámara
      </button>

      <div v-else class="space-y-2">
        <div class="relative rounded-lg overflow-hidden border border-slate-700 bg-black">
          <video ref="videoEl" class="w-full max-h-64 object-cover" muted playsinline></video>
          <div class="absolute inset-x-6 top-1/2 -translate-y-1/2 h-0.5 bg-indigo-500/70"></div>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-slate-500">Apunta al código de barras…</span>
          <button type="button" @click="stop" class="text-xs text-slate-400 hover:text-slate-200 transition">
            Detener
          </button>
        </div>
      </div>

      <p v-if="error" class="text-xs text-rose-400 mt-2">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'

const emit = defineEmits<{ detected: [code: string] }>()

const supported = ref(false)
const secure = ref(true)
const scanning = ref(false)
const error = ref('')
const videoEl = ref<HTMLVideoElement | null>(null)

let stream: MediaStream | null = null
let detector: any = null
let rafId: number | null = null

onMounted(() => {
  secure.value = window.isSecureContext
  supported.value =
    'BarcodeDetector' in window && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
})

const start = async () => {
  error.value = ''
  try {
    detector = new (window as any).BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']
    })
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    })
    scanning.value = true
    // Wait for the <video> to exist before attaching the stream to it.
    await nextTick()
    if (videoEl.value) {
      videoEl.value.srcObject = stream
      await videoEl.value.play()
    }
    scan()
  } catch (err: any) {
    error.value =
      err?.name === 'NotAllowedError'
        ? 'Permiso de cámara denegado. Escribe el código a mano.'
        : 'No se pudo iniciar la cámara. Escribe el código a mano.'
    stop()
  }
}

const scan = () => {
  if (!scanning.value || !videoEl.value || !detector) return
  detector
    .detect(videoEl.value)
    .then((codes: any[]) => {
      const value = codes?.[0]?.rawValue
      if (value) {
        emit('detected', String(value))
        stop()
        return
      }
      rafId = requestAnimationFrame(scan)
    })
    .catch(() => {
      rafId = requestAnimationFrame(scan)
    })
}

const stop = () => {
  scanning.value = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  stream?.getTracks().forEach(track => track.stop())
  stream = null
}

onBeforeUnmount(stop)
</script>
