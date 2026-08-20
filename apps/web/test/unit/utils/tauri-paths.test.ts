import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '~/utils/runtime';
import { resolveTauriAppPaths } from '~/utils/tauri-paths';

import { platform } from '@tauri-apps/plugin-os';

type TauriGlobal = { __TAURI_INTERNALS__?: unknown };

function clearTauriGlobal() {
  if (typeof window !== 'undefined') delete (window as TauriGlobal).__TAURI_INTERNALS__;
  delete (globalThis as TauriGlobal).__TAURI_INTERNALS__;
}

vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/mock-config'),
  appDataDir: vi.fn().mockResolvedValue('/mock-data'),
  appCacheDir: vi.fn().mockResolvedValue('/mock-cache'),
  tempDir: vi.fn().mockResolvedValue('/mock-temp'),
  documentDir: vi.fn().mockResolvedValue('/mock-documents'),
  isAbsolute: vi.fn().mockImplementation(async (path: string) => path.startsWith('/')),
  resourceDir: vi.fn().mockResolvedValue('/mock-resource'),
  resolve: vi.fn().mockImplementation(async (path: string) => {
    if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return path;
    return `/absolute/${path}`;
  }),
  join: vi.fn().mockImplementation(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn().mockReturnValue('linux'),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

describe('tauri-paths utility', () => {
  beforeEach(() => {
    vi.mocked(platform).mockReturnValue('linux');
  });

  afterEach(() => {
    clearTauriGlobal();
    vi.restoreAllMocks();
    vi.clearAllMocks();
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
      dataDir: '/mock-data',
      cacheDir: '/mock-cache',
      tempDir: '/mock-temp',
      documentsDir: '/mock-documents',
    });
  });

  it('mirrors Linux directory layout in dev mode by default', async () => {
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    const paths = await resolveTauriAppPaths('./.dev-files', true);
    expect(invoke).toHaveBeenCalledWith('allow_dev_directory_scope', {
      path: '/absolute/./.dev-files',
    });
    expect(paths).toEqual({
      configDir: '/absolute/./.dev-files/home/user/config/fastcat',
      dataDir: '/absolute/./.dev-files/home/user/local/share/fastcat',
      cacheDir: '/absolute/./.dev-files/home/user/cache/fastcat',
      tempDir: '/absolute/./.dev-files/tmp/fastcat',
      documentsDir: '/absolute/./.dev-files/home/user/Documents',
    });
  });

  it('mirrors Windows directory layout when platform is windows', async () => {
    const { platform } = await import('@tauri-apps/plugin-os');
    vi.mocked(platform).mockReturnValue('windows');
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    const paths = await resolveTauriAppPaths('C:/fastcat-dev', true);
    expect(invoke).toHaveBeenCalledWith('allow_dev_directory_scope', {
      path: 'C:/fastcat-dev',
    });
    expect(paths).toEqual({
      configDir: 'C:/fastcat-dev/Users/user/AppData/Roaming/fastcat',
      dataDir: 'C:/fastcat-dev/Users/user/AppData/Roaming/fastcat',
      cacheDir: 'C:/fastcat-dev/Users/user/AppData/Local/fastcat',
      tempDir: 'C:/fastcat-dev/Users/user/AppData/Local/Temp/fastcat',
      documentsDir: 'C:/fastcat-dev/Users/user/Documents',
    });
  });

  it('mirrors macOS directory layout when platform is macos', async () => {
    const { platform } = await import('@tauri-apps/plugin-os');
    vi.mocked(platform).mockReturnValue('macos');
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    const paths = await resolveTauriAppPaths('/tmp/fastcat-dev', true);
    expect(invoke).toHaveBeenCalledWith('allow_dev_directory_scope', {
      path: '/tmp/fastcat-dev',
    });
    expect(paths).toEqual({
      configDir: '/tmp/fastcat-dev/Users/user/Library/Application Support/fastcat',
      dataDir: '/tmp/fastcat-dev/Users/user/Library/Application Support/fastcat',
      cacheDir: '/tmp/fastcat-dev/Users/user/Library/Caches/fastcat',
      tempDir: '/tmp/fastcat-dev/tmp/fastcat',
      documentsDir: '/tmp/fastcat-dev/Users/user/Documents',
    });
  });

  it('still resolves dev paths if runtime scope extension fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('command not allowed'));
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);

    const paths = await resolveTauriAppPaths('./.dev-files', true);

    expect(paths).toEqual({
      configDir: '/absolute/./.dev-files/home/user/config/fastcat',
      dataDir: '/absolute/./.dev-files/home/user/local/share/fastcat',
      cacheDir: '/absolute/./.dev-files/home/user/cache/fastcat',
      tempDir: '/absolute/./.dev-files/tmp/fastcat',
      documentsDir: '/absolute/./.dev-files/home/user/Documents',
    });
  });
});
