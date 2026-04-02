// Vitest setup for Nuxt test environment

import { vi } from 'vitest';
import { config } from '@vue/test-utils';
import { ref } from 'vue';

// i18n mock factory
const createI18nMock = () => ({
  mode: 'composition',
  locale: ref('en-US'),
  fallbackLocale: ref('en-US'),
  t: (key: string, fallback?: string) => fallback ?? key,
  mergeLocaleMessage: vi.fn(),
  setLocaleMessage: vi.fn(),
  global: {
    t: (key: string, fallback?: string) => fallback ?? key,
    locale: ref('en-US'),
    fallbackLocale: ref('en-US'),
    mergeLocaleMessage: vi.fn(),
    setLocaleMessage: vi.fn(),
  },
  install: vi.fn(),
});

// Explicitly define named exports via a separate object to ensure Vitest sees them
const vueI18nMock = {
  useI18n: vi.fn(() => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    locale: ref('en-US'),
  })),
  createI18n: vi.fn(createI18nMock),
  __esModule: true,
};

vi.mock('vue-i18n', () => vueI18nMock);

vi.mock('#i18n', () => ({
  useI18n: vi.fn(() => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    locale: ref('en-US'),
  })),
  useLocaleRoute: vi.fn(() => (route: any) => route),
  useRouteBaseName: vi.fn(() => () => ''),
  useLocalePath: vi.fn(() => (path: string) => path),
  useSwitchLocalePath: vi.fn(() => (locale: string) => locale),
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
  if (typeof msg === 'string' && msg.includes('<Suspense> is an experimental feature')) return;
};

// Global stubs for Nuxt UI components
config.global.stubs = {
  ...config.global.stubs,
  UTooltip: { template: '<span><slot /></span>' },
  UContextMenu: { template: '<div><slot /></div>' },
  UIcon: { props: ['name'], template: '<span class="icon-mock" />' },
  UButton: { props: ['label'], template: '<button>{{ label }}<slot /></button>' },
};

config.global.mocks = {
  ...config.global.mocks,
  $t: (key: string, fallback?: string) => fallback ?? key,
};

// LocalStorage mock
class LocalStorageMock {
  private store: Record<string, string> = {};
  get length() { return Object.keys(this.store).length; }
  getItem(key: string) { return this.store[key] || null; }
  setItem(key: string, value: string) { this.store[key] = String(value); }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
  key(index: number) { return Object.keys(this.store)[index] || null; }
}

if (typeof window !== 'undefined') {
  if (!window.localStorage) {
    Object.defineProperty(window, 'localStorage', { value: new LocalStorageMock(), writable: true });
  }
} else {
  (globalThis as any).localStorage = new LocalStorageMock();
}
