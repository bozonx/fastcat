// Vitest setup for Nuxt test environment

// @nuxtjs/color-mode expects a global helper object at window[globalName].
// In unit tests (jsdom/happy-dom), that helper may be missing or incomplete.
// Provide a minimal implementation to avoid unhandled rejections during mount.

import { vi } from 'vitest';

const globalName = '__NUXT_COLOR_MODE__';

const w = globalThis as unknown as { window?: any };
if (w.window) {
  const helper = (w.window[globalName] ??= {});

  helper.preference ??= 'dark';
  helper.value ??= 'dark';

  helper.getColorScheme ??= () => 'dark';
  helper.addColorScheme ??= () => {};
  helper.removeColorScheme ??= () => {};
}

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    locale: { value: 'en' },
  }),
  createI18n: () => ({
    global: {
      t: (key: string) => key,
      locale: 'en',
    },
    install: () => {},
  }),
}));

vi.mock('#i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    locale: { value: 'en' },
  }),
  useLocalePath: () => (path: string) => path,
  useSwitchLocalePath: () => (locale: string) => locale,
}));

vi.stubGlobal('useColorMode', () => ({
  preference: 'dark',
  value: 'dark',
}));

vi.stubGlobal('useHead', () => {});
vi.stubGlobal('useRuntimeConfig', () => ({
  public: {},
}));
