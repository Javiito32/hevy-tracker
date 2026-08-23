// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss', '@nuxtjs/color-mode', '@nuxt/fonts', 'nuxt-auth-utils'],
  future: { compatibilityVersion: 3 },

  // Los tokens de tema viven en este archivo, así que sustituye la hoja que el
  // módulo de Tailwind inyecta por defecto en lugar de sumarse a ella.
  tailwindcss: { cssPath: '~/assets/css/main.css' },

  colorMode: {
    // `classSuffix: ''` deja `<html class="dark">` / `class="light"`, que es lo
    // que esperan los bloques :root / .dark de main.css. El módulo inyecta el
    // script anti-parpadeo antes del primer pintado, de modo que recargar en
    // cualquiera de los dos temas no muestra un fogonazo del contrario.
    preference: 'system',
    fallback: 'dark',
    classSuffix: '',
    storageKey: 'hevy-theme'
  },

  // Autoalojadas: elimina la petición bloqueante a fonts.googleapis.com que
  // había en app.head y de paso permite subsetting.
  fonts: {
    families: [
      { name: 'Archivo', provider: 'google', weights: [500, 600, 700] },
      { name: 'Inter', provider: 'google', weights: [400, 500, 600, 700] },
      { name: 'IBM Plex Mono', provider: 'google', weights: [400, 500, 600] }
    ]
  },
  runtimeConfig: {
    openaiApiKey: process.env.OPENAI_API_KEY,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    nutriinfoApiKey: process.env.NUTRIINFO_API_KEY,
    session: {
      password: process.env.NUXT_SESSION_PASSWORD || 'change-me-in-production-min-32-chars!!',
    }
  }
})
