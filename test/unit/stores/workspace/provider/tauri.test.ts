/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TauriWorkspaceProvider } from '~/stores/workspace/provider/tauri';
import { exists } from '@tauri-apps/plugin-fs';
import { TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';
import type { WorkspaceHandleStorage } from '~/repositories/workspace-handle.repository';

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn().mockResolvedValue('/mock-config'),
  appCacheDir: vi.fn().mockResolvedValue('/mock-cache'),
  documentDir: vi.fn().mockResolvedValue('/mock-documents'),
  isAbsolute: vi.fn().mockResolvedValue(false),
  resourceDir: vi.fn().mockResolvedValue('/mock-resource'),
  resolve: vi.fn().mockImplementation(async (path: string) => `/absolute/${path}`),
  join: vi.fn().mockImplementation(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('~/stores/workspace/provider/tauri-handle', () => ({
  TauriDirectoryHandle: vi.fn().mockImplementation(function (path: string, name: string) {
    return {
      kind: 'directory',
      path,
      name,
    };
  }),
}));

describe('TauriWorkspaceProvider', () => {
  let mockStorage: WorkspaceHandleStorage<string>;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(exists).mockReset();

    // Mock window to simulate Tauri environment being supported
    (globalThis as any).window = {
      __TAURI_INTERNALS__: {},
    };

    mockStorage = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    } as unknown as WorkspaceHandleStorage<string>;
  });

  afterEach(() => {
    // Restore window object
    if (originalWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
  });

  it('initializes correctly', () => {
    const provider = new TauriWorkspaceProvider(mockStorage);
    expect(provider.id).toBe('tauri');
    expect(provider.isSupported).toBe(true);
  });

  it('isSupported is false if window is undefined or missing __TAURI_INTERNALS__', () => {
    delete (globalThis as any).window;
    const provider1 = new TauriWorkspaceProvider(mockStorage);
    expect(provider1.isSupported).toBe(false);

    (globalThis as any).window = {};
    const provider2 = new TauriWorkspaceProvider(mockStorage);
    expect(provider2.isSupported).toBe(false);
  });

  describe('openWorkspace', () => {
    it('returns null if not supported', async () => {
      delete (globalThis as any).window;
      const provider = new TauriWorkspaceProvider(mockStorage);
      const result = await provider.openWorkspace();
      expect(result).toBeNull();
    });

    it('uses the default workspace instead of opening a folder dialog', async () => {
      vi.mocked(exists).mockResolvedValue(true);
      const provider = new TauriWorkspaceProvider(mockStorage);

      const result = await provider.openWorkspace();

      expect(exists).toHaveBeenCalledWith('/mock-documents/FastCat');
      expect(TauriDirectoryHandle).toHaveBeenCalledWith('/mock-documents/FastCat', 'FastCat');
      expect(result).toEqual({
        kind: 'directory',
        path: '/mock-documents/FastCat',
        name: 'FastCat',
      });
    });
  });

  describe('restoreWorkspace', () => {
    it('returns null if not supported', async () => {
      delete (globalThis as any).window;
      const provider = new TauriWorkspaceProvider(mockStorage);
      const result = await provider.restoreWorkspace();
      expect(result).toBeNull();
    });

    it('creates and returns the default workspace if no path is stored', async () => {
      vi.mocked(mockStorage.get).mockResolvedValue(undefined as any);
      vi.mocked(exists).mockResolvedValue(false);
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const provider = new TauriWorkspaceProvider(mockStorage);
      const result = await provider.restoreWorkspace();

      expect(exists).toHaveBeenCalledWith('/mock-documents/FastCat');
      expect(mkdir).toHaveBeenCalledWith('/mock-documents/FastCat', { recursive: true });
      expect(TauriDirectoryHandle).toHaveBeenCalledWith('/mock-documents/FastCat', 'FastCat');
      expect(result).toEqual({
        kind: 'directory',
        path: '/mock-documents/FastCat',
        name: 'FastCat',
      });
    });

    it('ignores stored paths and uses the default workspace', async () => {
      vi.mocked(mockStorage.get).mockResolvedValue('/mock/path');
      vi.mocked(exists).mockResolvedValue(false);
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const provider = new TauriWorkspaceProvider(mockStorage);

      const result = await provider.restoreWorkspace();

      expect(mockStorage.clear).toHaveBeenCalled();
      expect(exists).toHaveBeenCalledWith('/mock-documents/FastCat');
      expect(mkdir).toHaveBeenCalledWith('/mock-documents/FastCat', { recursive: true });
      expect(result).toEqual({
        kind: 'directory',
        path: '/mock-documents/FastCat',
        name: 'FastCat',
      });
    });

    it('does not probe a stored path even if it would be forbidden', async () => {
      vi.mocked(mockStorage.get).mockResolvedValue('/mock/forbidden-workspace');
      vi.mocked(exists).mockResolvedValueOnce(false);
      const { mkdir } = await import('@tauri-apps/plugin-fs');
      const provider = new TauriWorkspaceProvider(mockStorage);

      const result = await provider.restoreWorkspace();

      expect(mockStorage.clear).toHaveBeenCalled();
      expect(exists).not.toHaveBeenCalledWith('/mock/forbidden-workspace');
      expect(exists).toHaveBeenCalledWith('/mock-documents/FastCat');
      expect(mkdir).toHaveBeenCalledWith('/mock-documents/FastCat', { recursive: true });
      expect(result).toEqual({
        kind: 'directory',
        path: '/mock-documents/FastCat',
        name: 'FastCat',
      });
    });

    it('returns handle if path exists', async () => {
      vi.mocked(mockStorage.get).mockResolvedValue('/mock/path/project_restored');
      vi.mocked(exists).mockResolvedValue(true);
      const provider = new TauriWorkspaceProvider(mockStorage);

      const result = await provider.restoreWorkspace();

      expect(TauriDirectoryHandle).toHaveBeenCalledWith('/mock-documents/FastCat', 'FastCat');
      expect(result).toEqual({
        kind: 'directory',
        path: '/mock-documents/FastCat',
        name: 'FastCat',
      });
    });

    it('still uses the default workspace if clearing old storage fails', async () => {
      vi.mocked(mockStorage.clear).mockRejectedValueOnce(new Error('Storage error'));
      vi.mocked(exists).mockResolvedValue(true);
      const provider = new TauriWorkspaceProvider(mockStorage);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await provider.restoreWorkspace();

      expect(result).toEqual({
        kind: 'directory',
        path: '/mock-documents/FastCat',
        name: 'FastCat',
      });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('saveWorkspace', () => {
    it('does not persist custom workspace paths', async () => {
      const provider = new TauriWorkspaceProvider(mockStorage);
      const handle = { path: '/some/saved/path' } as any;
      await provider.saveWorkspace(handle);
      expect(mockStorage.set).not.toHaveBeenCalled();
      expect(mockStorage.clear).toHaveBeenCalled();
    });
  });

  describe('clearWorkspace', () => {
    it('clears storage', async () => {
      const provider = new TauriWorkspaceProvider(mockStorage);
      vi.mocked(mockStorage.clear).mockResolvedValue(undefined);

      await provider.clearWorkspace();

      expect(mockStorage.clear).toHaveBeenCalled();
    });

    it('catches error if clear fails', async () => {
      vi.mocked(mockStorage.clear).mockRejectedValue(new Error('Clear error'));
      const provider = new TauriWorkspaceProvider(mockStorage);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await provider.clearWorkspace();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
