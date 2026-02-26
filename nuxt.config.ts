import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  ssr: false,
  srcDir: 'src/',

  modules: [
    '@nuxt/ui',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    '@nuxt/eslint',
    ...(process.env.NODE_ENV === 'test' ? [] : ['@nuxtjs/color-mode']),
  ],

  css: ['~/assets/css/main.css'],

  ui: {
    colors: {
      primary: 'blue',
      neutral: 'slate',
    },
  },

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
    classSuffix: '',
  },

  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    locales: [
      { code: 'en', file: 'en-US.json' },
      { code: 'ru', file: 'ru-RU.json' },
    ],
    restructureDir: 'src',
    langDir: 'locales',
    vueI18n: '~/i18n.config.ts',
  },

  devtools: { enabled: true },

  compatibilityDate: '2024-11-01',

  typescript: {
    strict: true,
  },

  vite: {
    worker: {
      format: 'es',
    },
  },

  nitro: {
    preset: 'static',
  },

  app: {
    head: {
      title: 'Gran Video Editor',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
});
