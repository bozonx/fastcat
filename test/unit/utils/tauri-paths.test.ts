import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
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
  isAbsolute: vi.fn().mockImplementation(async (path: string) => path.startsWith('/')),
  resourceDir: vi.fn().mockResolvedValue('/mock-resource'),
  resolve: vi.fn().mockImplementation(async (path: string) => `/absolute/${path}`),
  join: vi.fn().mockImplementation(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
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

  it('resolves relative dev paths under the Tauri resource directory in dev mode', async () => {
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    const paths = await resolveTauriAppPaths('./.dev-files', true);
    expect(invoke).toHaveBeenCalledWith('allow_dev_directory_scope', {
      path: '/mock-resource/./.dev-files',
    });
    expect(paths).toEqual({
      configDir: '/mock-resource/./.dev-files/config',
      cacheDir: '/mock-resource/./.dev-files/cache',
      documentsDir: '/mock-resource/./.dev-files/Documents',
    });
  });

  it('resolves absolute dev paths directly in dev mode', async () => {
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    const paths = await resolveTauriAppPaths('/tmp/fastcat-dev', true);
    expect(invoke).toHaveBeenCalledWith('allow_dev_directory_scope', {
      path: '/absolute//tmp/fastcat-dev',
    });
    expect(paths).toEqual({
      configDir: '/absolute//tmp/fastcat-dev/config',
      cacheDir: '/absolute//tmp/fastcat-dev/cache',
      documentsDir: '/absolute//tmp/fastcat-dev/Documents',
    });
  });
});
