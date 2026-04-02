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
const { createNuxtMock } = vi.hoisted(() => ({
  createNuxtMock: vi.fn(() => ({
    $notificationService: { add: vi.fn() },
    $i18nService: { t: (key: string, fallback?: string) => fallback ?? key },
    _route: {
      path: '/',
      fullPath: '/',
      query: {},
      params: {},
      hash: '',
      sync: true,
    },
    runWithContext: (fn: any) => fn(),
  })),
}));

vi.mock('#app', () => ({
  useNuxtApp: vi.fn(createNuxtMock),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  useId: vi.fn(() => 'id'),
}));

vi.mock('nuxt/app', () => ({
  useNuxtApp: vi.fn(createNuxtMock),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  useId: vi.fn(() => 'id'),
}));

vi.mock('#imports', () => ({
  useNuxtApp: vi.fn(createNuxtMock),
  useI18n: vi.fn(() => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    locale: ref('en-US'),
  })),
  useRuntimeConfig: vi.fn(() => ({ public: {} })),
  useId: vi.fn(() => 'id'),
  useDevice: vi.fn(() => ({ isMobile: false, isDesktop: true })),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn() })),
  useRoute: vi.fn(() => ({ path: '/', query: {}, params: {} })),
}));

// Global stubs for non-aliased/auto-imported usage
(globalThis as any).useNuxtApp = createNuxtMock;
(globalThis as any).useRuntimeConfig = () => ({ public: {} });
(globalThis as any).useId = () => `id-${Math.random().toString(36).substring(2, 9)}`;
(globalThis as any).useAsyncData = () => ({ data: ref(null), pending: ref(false), error: ref(null) });
(globalThis as any).useI18n = () => ({
  t: (key: string, fallback?: string) => fallback ?? key,
  locale: ref('en-US'),
});
(globalThis as any).useToast = () => ({
  add: vi.fn(),
});
(globalThis as any).useDevice = () => ({ isMobile: false, isDesktop: true });
(globalThis as any).useColorMode = () => ({
  preference: 'dark',
  value: 'dark',
});
(globalThis as any).useHead = () => {};

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
  get length() {
    return Object.keys(this.store).length;
  }
  getItem(key: string) {
    return this.store[key] || null;
  }
  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }
  removeItem(key: string) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
  key(index: number) {
    return Object.keys(this.store)[index] || null;
  }
}

if (typeof window !== 'undefined') {
  if (!window.localStorage) {
    Object.defineProperty(window, 'localStorage', {
      value: new LocalStorageMock(),
      writable: true,
    });
  }
} else {
  (globalThis as any).localStorage = new LocalStorageMock();
}
