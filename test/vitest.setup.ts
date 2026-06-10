// Vitest setup for Nuxt test environment

import { vi } from 'vitest';
import { config } from '@vue/test-utils';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

// Initialize a single Pinia instance for the test process.
// Individual tests that need full isolation call setActivePinia(createPinia()) in their own beforeEach.
setActivePinia(createPinia());

// Mock global $fetch to prevent ReferenceError during Nuxt manifest prefetching
globalThis.$fetch = vi.fn().mockImplementation(() => Promise.resolve({})) as any;

// i18n mock factory
const createI18nMock = () => ({
  mode: 'composition',
  locale: ref('en-US'),
  fallbackLocale: ref('en-US'),
  t: (key: string, params?: string | Record<string, unknown>) =>
    typeof params === 'string' ? params : key,
  mergeLocaleMessage: vi.fn(),
  setLocaleMessage: vi.fn(),
  global: {
    t: (key: string, params?: string | Record<string, unknown>) =>
      typeof params === 'string' ? params : key,
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
    t: (key: string, params?: string | Record<string, unknown>) =>
      typeof params === 'string' ? params : key,
    locale: ref('en-US'),
  })),
  createI18n: vi.fn(createI18nMock),
  __esModule: true,
};

vi.mock('vue-i18n', () => vueI18nMock);

vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({ path: '/', fullPath: '/', query: {}, params: {}, hash: '', meta: { layout: 'default' } })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    go: vi.fn(),
    back: vi.fn(),
    afterEach: vi.fn(),
  })),
  createWebHistory: vi.fn(() => ({ type: 'history', location: '/' })),
  createMemoryHistory: vi.fn(() => ({ type: 'memory', location: '/' })),
}));

vi.mock('#i18n', () => ({
  useI18n: vi.fn(() => ({
    t: (key: string, params?: string | Record<string, unknown>) =>
      typeof params === 'string' ? params : key,
    locale: ref('en-US'),
  })),
  useLocaleRoute: vi.fn(() => (route: any) => route),
  useRouteBaseName: vi.fn(() => () => ''),
  useLocalePath: vi.fn(() => (path: string) => path),
  useSwitchLocalePath: vi.fn(() => (locale: string) => locale),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    isEphemeral: false,
    workspaceHandle: null,
    isSttModelDownloaded: false,
    userSettings: {
      timeline: {
        defaultStaticClipDurationUs: 5_000_000,
        snapThresholdPx: 10,
        snapping: {
          timelineEdges: true,
          playhead: true,
          playheadClick: true,
          markers: true,
          clips: true,
          selection: true,
        },
      },
      history: {
        maxEntries: 100,
      },
      projectDefaults: {
        audioScrubbingEnabled: true,
      },
      ui: {
        interfaceScale: 1,
      },
      hotkeys: {
        layer1: 'Shift',
        layer2: 'Control',
        bindings: {},
      },
      integrations: {
        fastcatAccount: { enabled: false, bearerToken: '' },
        fastcatPublicador: { enabled: false, bearerToken: '' },
        manualFilesApi: {
          enabled: false,
          baseUrl: '',
          bearerToken: '',
          overrideFastCat: false,
        },
        stt: {
          provider: '',
          models: [],
          localModel: 'Xenova/whisper-tiny',
          language: '',
          restorePunctuation: true,
          formatText: false,
          includeWords: true,
        },
      },
      mouse: {
        monitor: {
          wheel: 'zoom',
        },
        ruler: {
          shiftClick: 'playSelection',
        },
      },
    },
    workspaceState: {
      fileBrowser: {
        instances: {},
      },
      presets: {
        custom: [],
        defaultText: '',
      },
    },
    batchUpdateUserSettings: vi.fn(),
    batchUpdateWorkspaceState: vi.fn(),
    init: vi.fn(),
  })),
}));

const { createNuxtMock } = vi.hoisted(() => ({
  createNuxtMock: vi.fn(() => ({
    $notificationService: { add: vi.fn() },
    $i18nService: { t: (key: string, fallback?: string) => fallback ?? key },
    $vfs: {
      getMetadata: vi.fn(),
      getFile: vi.fn(),
      readDirectory: vi.fn(),
      listEntryNames: vi.fn().mockResolvedValue([]),
      copyFile: vi.fn().mockResolvedValue(undefined),
      createDirectory: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(new Uint8Array()),
    },
    _route: {
      path: '/',
      fullPath: '/',
      query: {},
      params: {},
      hash: '',
      sync: vi.fn(() => Promise.resolve()),
    },
    runWithContext: (fn: any) => fn(),
    vueApp: {
      component: vi.fn(),
      config: { globalProperties: {} },
    },
  })),
}));

vi.mock('#app/composables/router', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    go: vi.fn(),
    back: vi.fn(),
    afterEach: vi.fn(),
  })),
  useRoute: vi.fn(() => ({ path: '/', fullPath: '/', query: {}, params: {}, hash: '', meta: { layout: 'default' } })),
  defineNuxtRouteMiddleware: vi.fn((mw) => mw),
  navigateTo: vi.fn(),
}));

vi.mock('#app', () => ({
  useNuxtApp: createNuxtMock,
  defineNuxtComponent: vi.fn((options) => options),
  definePageMeta: vi.fn(),
  defineProps: vi.fn(() => ({})),
  defineEmits: vi.fn(() => vi.fn()),
  defineNuxtPlugin: vi.fn((plugin) => plugin),
  useRoute: vi.fn(() => ({ path: '/', fullPath: '/', query: {}, params: {}, hash: '', meta: { layout: 'default' } })),
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), go: vi.fn(), back: vi.fn(), afterEach: vi.fn() })),
  useAsyncData: vi.fn(() => ({ data: ref(null), pending: ref(false), error: ref(null) })),
  useState: vi.fn((key: string, init?: () => any) => ref(init ? init() : null)),
  useHead: vi.fn(),
  useFetch: vi.fn(() => ({ data: ref(null), pending: ref(false), error: ref(null) })),
  refresh: vi.fn(),
  navigateTo: vi.fn(),
  useCookie: vi.fn(() => ({ value: null })),
  useRequestURL: vi.fn(() => ({ href: 'http://localhost', origin: 'http://localhost' })),
  useRuntimeConfig: vi.fn(() => ({
    public: {},
    app: { baseURL: '/' },
  })),
}));

vi.mock('#ui/composables/useToast', () => {
  const toastMaxInjectionKey = Symbol('toastMaxInjectionKey');
  return {
    useToast: vi.fn(() => ({ add: vi.fn(), remove: vi.fn() })),
    toastMaxInjectionKey,
  };
});

vi.mock('~/utils/video-editor/worker-client', () => ({
  getPreviewWorkerClient: () => ({ client: {}, worker: {} }),
  setPreviewHostApi: vi.fn(),
  setProxyHostApi: vi.fn(),
}));

vi.mock('#ui/utils', () => ({
  get: vi.fn(),
  omit: vi.fn(),
  mergeConfig: vi.fn(),
  getDisplayValue: vi.fn((items: any[], value: any, options: any) => {
    if (!items || items.length === 0) return '';
    const item = items.find((i: any) => i[options?.valueKey || 'value'] === value);
    return item ? item[options?.labelKey || 'label'] : '';
  }),
  isArrayOfArray: vi.fn(
    (arr: any) => Array.isArray(arr) && arr.length > 0 && Array.isArray(arr[0]),
  ),
}));

// Global stubs for Nuxt UI components
config.global.stubs = {
  ...config.global.stubs,
  UTooltip: { template: '<span><slot /></span>' },
  UContextMenu: { template: '<div><slot /></div>' },
  UIcon: { props: ['name'], template: '<span class="icon-mock" />' },
  UButton: { props: ['label'], template: '<button>{{ label }}<slot /></button>' },
  UModal: {
    props: ['open', 'title', 'description', 'close', 'ui', 'dismissible', 'content'],
    template: `
      <div v-if="open" class="modal-mock" role="dialog">
        <div class="modal-header">
          <h2>{{ title }}</h2>
          <p v-if="description">{{ description }}</p>
          <slot name="header" />
        </div>
        <div class="modal-body"><slot name="body" /><slot /></div>
        <div class="modal-footer"><slot name="footer" /></div>
        <button v-if="close" class="modal-close" @click="$emit('update:open', false)">×</button>
      </div>
    `,
    watch: {
      open(val: boolean) {
        if (val && (this as any).content?.onOpenAutoFocus) {
          (this as any).content.onOpenAutoFocus(new Event('openAutoFocus'));
        }
      },
    },
    mounted(this: any) {
      if (this.open && this.content?.onOpenAutoFocus) {
        this.content.onOpenAutoFocus(new Event('openAutoFocus'));
      }
    },
  },
};

config.global.mocks = {
  ...config.global.mocks,
  $t: (key: string, params?: string | Record<string, unknown>) =>
    typeof params === 'string' ? params : key,
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

// Stub global useNuxtApp so @nuxt/test-utils setupNuxt sees _route.sync
vi.stubGlobal('useNuxtApp', createNuxtMock);

// Always override localStorage/sessionStorage to avoid issues in happy-dom
// and ensure our mock is present regardless of environment
Object.defineProperty(globalThis, 'localStorage', {
  value: new LocalStorageMock(),
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: new LocalStorageMock(),
  writable: true,
  configurable: true,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: globalThis.localStorage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: globalThis.sessionStorage,
    writable: true,
    configurable: true,
  });
} else {
  // Mock window for code that explicitly uses window.setTimeout etc. in node environment
  (globalThis as any).window = globalThis;
  (globalThis as any).location = {
    pathname: '/',
    search: '',
    hash: '',
    origin: 'http://localhost',
    href: 'http://localhost/',
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
  };
  (globalThis as any).addEventListener = vi.fn();
  (globalThis as any).removeEventListener = vi.fn();
}
