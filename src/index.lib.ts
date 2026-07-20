import { createDevLogger } from '~/utils/dev-logger';
import { defineCustomElement, h, provide } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n, I18nInjectionKey } from 'vue-i18n';
import FastcatEmbeddedLayout from '~/components/embedded/FastcatEmbeddedLayout.vue';
import mainCss from '~/assets/css/main.css?inline';

// Locales
import enUS from './locales/en-US.json';
import ruRU from './locales/ru-RU.json';
import es419 from './locales/es-419.json';
const log = createDevLogger('index.lib');

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  messages: {
    'en-US': enUS,
    'ru-RU': ruRU,
    'es-419': es419,
  },
});

/**
 * Custom Element Wrapper for Fastcat Editor
 */
const FastcatElement = defineCustomElement({
  props: {
    assets: { type: Array, default: () => [] },
    workspaceId: { type: String, default: '' },
    locale: { type: String, default: 'en-US' },
  },
  setup(props, { emit }) {
    const pinia = createPinia();
    setActivePinia(pinia);

    // Provide Pinia and i18n to the context of the Shadow DOM components
    // Note: Pinia 2.0+ uses a symbol internally, but setActivePinia is often sufficient
    // for useStore() calls within setup() and its synchronous sub-calls.
    provide('pinia', pinia);

    // Provide i18n using the official injection key so useI18n() works
    provide(I18nInjectionKey, i18n);

    // Provide Nuxt-like services that are expected by components via useNuxtApp()
    provide('isEmbedded', true);
    provide('notificationService', {
      // Intentional fallback output when the embedding host provides no service.

      add: (msg: unknown) => log.log('[Embedded Editor] Notification:', msg),
    });
    provide('i18nService', {
      t: (key: string, ...args: unknown[]) =>
        (i18n.global.t as (key: string, ...args: unknown[]) => string)(key, ...args),
    });
    provide('i18n', i18n.global);

    return () =>
      h(FastcatEmbeddedLayout, {
        assets: props.assets as import('~/utils/external-assets.service').ExternalAsset[],
        workspaceId: props.workspaceId,
        locale: props.locale,
        onExported: (data: unknown) => emit('fastcat:exported', data),
      });
  },
  // Inject our global Tailwind CSS into the Shadow DOM
  styles: [mainCss],
});

// Register the custom element
if (typeof customElements !== 'undefined' && !customElements.get('fastcat-editor')) {
  customElements.define('fastcat-editor', FastcatElement);
}

/**
 * Public SDK for easy integration
 */
export class FastcatEditor {
  private element: HTMLElement | null = null;

  constructor(private container: HTMLElement | string) {}

  public init(options: { assets: unknown[]; workspaceId?: string; locale?: string }) {
    const target =
      typeof this.container === 'string' ? document.querySelector(this.container) : this.container;

    if (!target) throw new Error(`Container ${this.container} not found`);

    this.element = document.createElement('fastcat-editor');
    (this.element as HTMLElement & { assets?: unknown[] }).assets = options.assets;
    if (options.workspaceId) {
      (this.element as HTMLElement & { workspaceId?: string }).workspaceId = options.workspaceId;
    }
    if (options.locale) {
      (this.element as HTMLElement & { locale?: string }).locale = options.locale;
    }

    target.appendChild(this.element);
    return this.element;
  }

  public destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}

// Export for UMD/ESM usage
export default FastcatEditor;
