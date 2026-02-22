import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  srcDir: 'src/',

  modules: [
    '@nuxt/ui',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
  ],

  css: ['~/assets/css/main.css'],

  ui: {
    // @ts-ignore
    colorMode: false
  },

  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'en', file: 'en-US.json' },
      { code: 'ru', file: 'ru-RU.json' },
    ],
    langDir: 'locales/',
    vueI18n: {
      legacy: false,
      locale: 'en',
      fallbackLocale: 'en',
    },
  },

  devtools: { enabled: true },

  compatibilityDate: '2024-11-01',

  typescript: {
    strict: true,
  },

  nitro: {
    preset: 'static',
  },

  app: {
    head: {
      title: 'Gran Video Editor',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
})
