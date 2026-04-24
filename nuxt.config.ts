// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxtjs/tailwindcss', 'nuxt-auth-utils'],
  future: { compatibilityVersion: 3 },
  runtimeConfig: {
    hevyApiKey: process.env.HEVY_API_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
    session: {
      password: process.env.NUXT_SESSION_PASSWORD || 'change-me-in-production-min-32-chars!!',
    }
  }
})
