import { defineNuxtConfig } from 'nuxt/config';

function unwrapI18nJsonResource() {
  return {
    name: 'fastcat:unwrap-i18n-json-resource',
    enforce: 'post' as const,
    transform(code: string, id: string) {
      if (!id.includes('/locales/') || !id.includes('.json?import')) return;

      const match = code.match(/^export default \/\* #__PURE__ \*\/ JSON\.parse\(([\s\S]+)\)$/);
      if (!match) return;

      const generatedResource = JSON.parse(match[1]) as string;
      if (!generatedResource.startsWith('const resource = ')) return;

      return {
        code: generatedResource,
        map: null,
      };
    },
  };
}

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
      { code: 'en-US', file: 'en-US.json' },
      { code: 'ru-RU', file: 'ru-RU.json' },
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
    },
  },

  vite: {
    json: {
      stringify: false,
    },
    plugins: [unwrapI18nJsonResource()],
    worker: {
      format: 'es',
    },
  },

  nitro: {
    preset: 'static',
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
    },
  },
});
