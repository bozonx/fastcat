import { defineCustomElement, h, provide } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import FastcatEmbeddedLayout from '~/components/embedded/FastcatEmbeddedLayout.vue';
import mainCss from '~/assets/css/main.css?inline';

// Locales
import enUS from './locales/en-US.json';
import ruRU from './locales/ru-RU.json';

const i18n = createI18n({
  legacy: false,
  locale: 'en-US',
  fallbackLocale: 'en-US',
  messages: {
    'en-US': enUS,
    'ru-RU': ruRU,
  }
});

/**
 * Custom Element Wrapper for Fastcat Editor
 */
const FastcatElement = defineCustomElement({
  props: {
    assets: { type: Array, default: () => [] }
  },
  setup(props, { emit }) {
    const pinia = createPinia();
    setActivePinia(pinia);

    // Provide Pinia and i18n to the context of the Shadow DOM components
    provide('pinia', pinia);
    
    // In Vue 3 setup, we might need a more complex way to provide i18n for useI18n()
    // but for most common cases, providing it directly or wrapping with a provider works.
    
    return () => h(FastcatEmbeddedLayout, {
      assets: props.assets as any,
      onExported: () => emit('fastcat:exported')
    });
  },
  // Inject our global Tailwind CSS into the Shadow DOM
  styles: [mainCss] 
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

  public init(options: { assets: any[] }) {
    const target = typeof this.container === 'string' 
      ? document.querySelector(this.container) 
      : this.container;

    if (!target) throw new Error(`Container ${this.container} not found`);

    this.element = document.createElement('fastcat-editor');
    (this.element as any).assets = options.assets;
    
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
