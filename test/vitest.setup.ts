// Vitest setup for Nuxt test environment

// @nuxtjs/color-mode expects a global helper object at window[globalName].
// In unit tests (jsdom/happy-dom), that helper may be missing or incomplete.
// Provide a minimal implementation to avoid unhandled rejections during mount.

import { vi } from 'vitest';
import { config } from '@vue/test-utils';

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
    mergeLocaleMessage: () => {},
    setLocaleMessage: () => {},
    global: {
      t: (key: string) => key,
      locale: 'en',
      mergeLocaleMessage: () => {},
      setLocaleMessage: () => {},
    },
    install: () => {},
  }),
}));

vi.mock('#i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    locale: { value: 'en' },
  }),
  useLocaleRoute: () => (route: any) => route,
  useRouteBaseName: () => () => '',
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

config.global.config.warnHandler = (msg) => {
  if (typeof msg === 'string' && msg.includes('Invalid watch source:')) return;
  if (typeof msg === 'string' && msg.includes('<Suspense> is an experimental feature')) return;
};

function shouldIgnoreConsoleMessage(args: unknown[]) {
  const parts = args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message;
    return '';
  });

  const msg = parts.join(' ');

  if (msg.includes('i18n.mergeLocaleMessage is not a function')) return true;
  if (parts.some((p) => p.includes('Invalid watch source:'))) return true;
  if (msg.includes('<Suspense> is an experimental feature')) return true;
  return false;
}

const originalWarn = console.warn.bind(console);
const originalError = console.error.bind(console);
const originalLog = console.log.bind(console);
const originalInfo = console.info.bind(console);

vi.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
  if (shouldIgnoreConsoleMessage(args)) return;
  originalWarn(...args);
});

vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
  if (shouldIgnoreConsoleMessage(args)) return;
  originalError(...args);
});

vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
  if (shouldIgnoreConsoleMessage(args)) return;
  originalLog(...args);
});

vi.spyOn(console, 'info').mockImplementation((...args: any[]) => {
  if (shouldIgnoreConsoleMessage(args)) return;
  originalInfo(...args);
});
