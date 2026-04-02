/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TauriWorkspaceProvider } from '~/stores/workspace/provider/tauri';
import { open } from '@tauri-apps/plugin-dialog';
import { exists } from '@tauri-apps/plugin-fs';
import { TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';
import type { WorkspaceHandleStorage } from '~/repositories/workspace-handle.repository';

// Mock dependencies
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
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

    // Mock window to simulate Tauri environment being supported
    (globalThis as any).window = {
      __TAURI_INTERNALS__: {},
    };

    mockStorage = {
      get: vi.fn(),
      set: vi.fn(),
      clear: vi.fn(),
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

    it('returns null if open dialog is cancelled', async () => {
      vi.mocked(open).mockResolvedValue(null);
      const provider = new TauriWorkspaceProvider(mockStorage);
      const result = await provider.openWorkspace();
      expect(result).toBeNull();
    });

    it('returns null if open dialog returns empty array', async () => {
      vi.mocked(open).mockResolvedValue([]);
      const provider = new TauriWorkspaceProvider(mockStorage);
      const result = await provider.openWorkspace();
      expect(result).toBeNull();
    });

    it('returns handle and saves to storage if path is selected (string)', async () => {
      vi.mocked(open).mockResolvedValue('/mock/path/project');
      const provider = new TauriWorkspaceProvider(mockStorage);

      const result = await provider.openWorkspace();

      expect(mockStorage.set).toHaveBeenCalledWith('/mock/path/project');
      expect(TauriDirectoryHandle).toHaveBeenCalledWith('/mock/path/project', 'project');
      expect(result).toEqual({
        kind: 'directory',
        path: '/mock/path/project',
        name: 'project',
      });
    });

    it('returns handle and saves to storage if path is selected (array)', async () => {
      vi.mocked(open).mockResolvedValue(['/mock/path/project2']);
      const provider = new TauriWorkspaceProvider(mockStorage);

      const result = await provider.openWorkspace();

      expect(mockStorage.set).toHaveBeenCalledWith('/mock/path/project2');
      expect(TauriDirectoryHandle).toHaveBeenCalledWith('/mock/path/project2', 'project2');
      expect(result).toEqual({
        kind: 'directory',
        path: '/mock/path/project2',
        name: 'project2',
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

    it('returns null if no path in storage', async () => {
      vi.mocked(mockStorage.get).mockResolvedValue(undefined as any);
      const provider = new TauriWorkspaceProvider(mockStorage);
      const result = await provider.restoreWorkspace();
      expect(result).toBeNull();
    });

    it('returns null if path does not exist', async () => {
      vi.mocked(mockStorage.get).mockResolvedValue('/mock/path');
      vi.mocked(exists).mockResolvedValue(false);
      const provider = new TauriWorkspaceProvider(mockStorage);

      const result = await provider.restoreWorkspace();

      expect(exists).toHaveBeenCalledWith('/mock/path');
      expect(result).toBeNull();
    });

    it('returns handle if path exists', async () => {
      vi.mocked(mockStorage.get).mockResolvedValue('/mock/path/project_restored');
      vi.mocked(exists).mockResolvedValue(true);
      const provider = new TauriWorkspaceProvider(mockStorage);

      const result = await provider.restoreWorkspace();

      expect(TauriDirectoryHandle).toHaveBeenCalledWith(
        '/mock/path/project_restored',
        'project_restored',
      );
      expect(result).toEqual({
        kind: 'directory',
        path: '/mock/path/project_restored',
        name: 'project_restored',
      });
    });

    it('returns null and catches error if storage get fails', async () => {
      vi.mocked(mockStorage.get).mockRejectedValue(new Error('Storage error'));
      const provider = new TauriWorkspaceProvider(mockStorage);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await provider.restoreWorkspace();

      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('saveWorkspace', () => {
    it('saves handle path to storage', async () => {
      const provider = new TauriWorkspaceProvider(mockStorage);
      const handle = { path: '/some/saved/path' } as any;
      await provider.saveWorkspace(handle);
      expect(mockStorage.set).toHaveBeenCalledWith('/some/saved/path');
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
