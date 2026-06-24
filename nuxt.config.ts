import { defineNuxtConfig } from 'nuxt/config';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const fastcatDevDir = resolve(import.meta.dirname, process.env.FASTCAT_DEV_DIR || './.dev-files');

// Ensure dev-mode OS-like directory tree exists before Tauri starts.
// This avoids I/O errors when Tauri plugin-fs mkdir hits missing parents.
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
  const platform = process.platform;
  const user = 'user';
  const app = 'fastcat';

  const ensureDir = (subPath: string) => {
    try {
      mkdirSync(resolve(fastcatDevDir, subPath), { recursive: true });
    } catch {
      // ignore
    }
  };

  if (platform === 'win32') {
    ensureDir(`Users/${user}/AppData/Roaming/${app}`);
    ensureDir(`Users/${user}/AppData/Local/${app}`);
    ensureDir(`Users/${user}/AppData/Local/Temp/${app}`);
    ensureDir(`Users/${user}/Documents`);
  } else if (platform === 'darwin') {
    ensureDir(`Users/${user}/Library/Application Support/${app}`);
    ensureDir(`Users/${user}/Library/Caches/${app}`);
    ensureDir(`tmp/${app}`);
    ensureDir(`Users/${user}/Documents`);
  } else {
    ensureDir(`home/${user}/config/${app}`);
    ensureDir(`home/${user}/local/share/${app}`);
    ensureDir(`home/${user}/cache/${app}`);
    ensureDir(`tmp/${app}`);
    ensureDir(`home/${user}/Documents`);
  }
}

export default defineNuxtConfig({
  ssr: false,
  srcDir: 'src/',

  // Top-level `shared/` dir holds cross-backend assets (e.g. the effect WGSL
  // shader) consumed by both the web build (`~shared/...?raw`) and Rust
  // (`include_str!`).
  alias: {
    '~shared': resolve(import.meta.dirname, 'shared'),
  },

  modules: [
    '@nuxt/ui',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    '@nuxtjs/device',
    '@nuxt/eslint',
    ...(process.env.NODE_ENV === 'test' ? [] : ['@nuxtjs/color-mode']),
  ],

  css: ['~/assets/css/main.css'],

  // Bundle all used icons into the client build so they never get fetched from
  // api.iconify.design at runtime. The Tauri (WebKitGTK) webview is offline and
  // the remote fetch fails there, leaving the Iconify dot-placeholder instead of
  // the real glyph (e.g. the "3 dots" ellipsis menu rendering as a dot blob).
  icon: {
    clientBundle: {
      scan: true,
      sizeLimitKb: 1024,
    },
    fallbackToApi: false,
  },

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
      fastcatDevDir,
    },
  },

  vite: {
    optimizeDeps: {
      include: [
        'p-queue',
        '@tauri-apps/api/core',
        '@tauri-apps/api/path',
        '@tauri-apps/api/webview',
        '@tauri-apps/api/window',
        '@tauri-apps/plugin-fs',
        '@tauri-apps/plugin-dialog',
        'tauri-plugin-fs-stream-api',
        'pixi.js',
        'zod',
        '@vueuse/core',
      ],
    },
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
      link: [],
    },
  },
});
