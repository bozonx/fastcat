import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTauriRuntime } from '~/utils/runtime';
import { resolveTauriAppPaths } from '~/utils/tauri-paths';

type TauriGlobal = { __TAURI_INTERNALS__?: unknown };

function clearTauriGlobal() {
  if (typeof window !== 'undefined') delete (window as TauriGlobal).__TAURI_INTERNALS__;
  delete (globalThis as TauriGlobal).__TAURI_INTERNALS__;
}

vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/mock-config'),
  appCacheDir: vi.fn().mockResolvedValue('/mock-cache'),
  documentDir: vi.fn().mockResolvedValue('/mock-documents'),
  resolve: vi.fn().mockImplementation(async (path: string) => `/absolute/${path}`),
  join: vi.fn().mockImplementation(async (...parts: string[]) => parts.join('/')),
}));

describe('tauri-paths utility', () => {
  afterEach(() => {
    clearTauriGlobal();
    vi.restoreAllMocks();
  });

  it('returns null when not in Tauri runtime', async () => {
    clearTauriGlobal();
    expect(isTauriRuntime()).toBe(false);

    const paths = await resolveTauriAppPaths('./.dev-files');
    expect(paths).toBeNull();
  });

  it('returns production paths when in Tauri runtime and devDir is not provided', async () => {
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    const paths = await resolveTauriAppPaths(undefined);
    expect(paths).toEqual({
      configDir: '/mock-config',
      cacheDir: '/mock-cache',
      documentsDir: '/mock-documents',
    });
  });

  it('resolves OS-specific paths under devRoot in dev mode', async () => {
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    // Mock navigator.userAgent to simulate Linux
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Linux',
      configurable: true,
    });

    const paths = await resolveTauriAppPaths('./.dev-files', true);
    expect(paths).toEqual({
      configDir: '/absolute/./.dev-files/.config/com.bozonx.fastcat',
      cacheDir: '/absolute/./.dev-files/.cache/com.bozonx.fastcat',
      documentsDir: '/absolute/./.dev-files/Documents',
    });

    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it('resolves macOS paths under devRoot in dev mode', async () => {
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Macintosh; Intel Mac OS X 10_15_7',
      configurable: true,
    });

    const paths = await resolveTauriAppPaths('./.dev-files', true);
    expect(paths).toEqual({
      configDir: '/absolute/./.dev-files/Library/Application Support/com.bozonx.fastcat',
      cacheDir: '/absolute/./.dev-files/Library/Caches/com.bozonx.fastcat',
      documentsDir: '/absolute/./.dev-files/Documents',
    });

    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  it('resolves Windows paths under devRoot in dev mode', async () => {
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Windows NT 10.0; Win64; x64',
      configurable: true,
    });

    const paths = await resolveTauriAppPaths('./.dev-files', true);
    expect(paths).toEqual({
      configDir: '/absolute/./.dev-files/AppData/Roaming/com.bozonx.fastcat',
      cacheDir: '/absolute/./.dev-files/AppData/Local/com.bozonx.fastcat',
      documentsDir: '/absolute/./.dev-files/Documents',
    });

    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });
});
