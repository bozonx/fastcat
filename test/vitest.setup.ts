// Vitest setup for Nuxt test environment

// @nuxtjs/color-mode expects a global helper object at window[globalName].
// In unit tests (jsdom/happy-dom), that helper may be missing or incomplete.
// Provide a minimal implementation to avoid unhandled rejections during mount.

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
