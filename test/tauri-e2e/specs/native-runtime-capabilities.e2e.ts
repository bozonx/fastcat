import { browser, expect, $ } from '@wdio/globals';

describe('Native Runtime Capabilities (P0)', () => {
  it('correctly detects Tauri runtime in window environment', async () => {
    const isTauriEnv = await browser.execute(() => {
      const hasTauriInternals = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      const hasGlobalThis =
        typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;
      return hasTauriInternals || hasGlobalThis;
    });

    expect(isTauriEnv).toBe(true);
  });

  it('exposes native desktop capabilities via IPC boundary', async () => {
    const hasInvoke = await browser.execute(() => {
      return (
        typeof window !== 'undefined' &&
        '__TAURI_INTERNALS__' in window &&
        typeof (window as any).__TAURI_INTERNALS__?.invoke === 'function'
      );
    });

    expect(hasInvoke).toBe(true);
  });

  it('does not display web-only fallback warnings on initial app shell mount', async () => {
    // Web-only fallback banners (e.g. OPFS browser warnings or unsupported desktop notices)
    const webOnlyWarning = await $('[data-testid="web-fallback-warning"]');
    const isPresent = await webOnlyWarning.isExisting();
    expect(isPresent).toBe(false);
  });
});
