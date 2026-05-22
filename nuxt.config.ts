import { defineNuxtConfig } from 'nuxt/config';

export default defineNuxtConfig({
  ssr: false,
  srcDir: 'src/',

  modules: [
    '@nuxt/ui',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    '@nuxtjs/device',
    '@nuxt/eslint',
    ...(process.env.NODE_ENV === 'test' ? [] : ['@nuxtjs/color-mode']),
  ],

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'dark',
    fallback: 'dark',
    classSuffix: '',
  },

  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en-US',
    locales: [
      { code: 'en-US', file: 'en-US.ts' },
      { code: 'ru-RU', file: 'ru-RU.ts' },
    ],
    restructureDir: 'src',
    langDir: 'locales',
    vueI18n: '~/i18n.config.ts',
  },

  devtools: { enabled: true },

  devServer: {
    port: 3009,
  },

  compatibilityDate: '2024-11-01',

  typescript: {
    strict: true,
  },

  runtimeConfig: {
    public: {
      bloggerDogApiUrl: '',
      bloggerDogUiUrl: '',
      fastcatAccountApiUrl: '',
      fastcatAccountUiUrl: '',
      blockContextMenu: true,
      fastcatDevDir: process.env.FASTCAT_DEV_DIR || './.dev-files',
    },
  },

  vite: {
    worker: {
      format: 'es',
    },
    plugins: [
      {
        name: 'fastcat:e2e-headers',
        configureServer(server) {
          if (process.env.E2E_TEST !== '1') return;

          server.middlewares.use((_req, res, next) => {
            res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            next();
          });
        },
      },
    ],
  },

  nitro: {
    preset: 'static',
    output: process.env.E2E_OUTPUT_DIR
      ? {
          dir: process.env.E2E_OUTPUT_DIR,
        }
      : undefined,
  },

  app: {
    head: {
      title: 'FastCat',
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
        },
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Roboto:wght@400;700&family=Montserrat:wght@400;700&family=Oswald:wght@400;700&family=Noto+Sans:wght@400;700&family=Open+Sans:wght@400;700&family=Playfair+Display:wght@400;700&family=Lato:wght@400;700&display=swap',
        },
      ],
    },
  },
});
