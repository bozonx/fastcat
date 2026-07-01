/** @vitest-environment node */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { WebWorkspaceProvider } from '~/stores/workspace/provider/web';

describe('WebWorkspaceProvider', () => {
  function makeStorage() {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has id "web"', () => {
    const provider = new WebWorkspaceProvider(makeStorage() as any);
    expect(provider.id).toBe('web');
  });

  it('isSupported is false in node env', () => {
    const provider = new WebWorkspaceProvider(makeStorage() as any);
    expect(provider.isSupported).toBe(false);
  });

  it('openWorkspace returns null when not supported', async () => {
    const provider = new WebWorkspaceProvider(makeStorage() as any);
    const result = await provider.openWorkspace();
    expect(result).toBeNull();
  });

  it('restoreWorkspace returns null when not supported', async () => {
    const provider = new WebWorkspaceProvider(makeStorage() as any);
    const result = await provider.restoreWorkspace();
    expect(result).toBeNull();
  });

  it('opens an OPFS sandbox when StorageManager.getDirectory is available', async () => {
    const handle = { name: 'fastcat-workspace', kind: 'directory' };
    const getDirectoryHandle = vi.fn().mockResolvedValue(handle);
    const getDirectory = vi.fn().mockResolvedValue({ getDirectoryHandle });
    const storage = makeStorage();

    vi.stubGlobal('navigator', {
      storage: { getDirectory },
    });

    const provider = new WebWorkspaceProvider(storage as any);
    const result = await provider.openWorkspace();

    expect(provider.isSupported).toBe(true);
    expect(getDirectory).toHaveBeenCalled();
    expect(getDirectoryHandle).toHaveBeenCalledWith('fastcat-workspace', { create: true });
    expect(storage.set).toHaveBeenCalledWith(handle);
    expect(result).toBe(handle);
  });

  it('uses the configured OPFS sandbox name from localStorage', async () => {
    const handle = { name: 'e2e-workspace', kind: 'directory' };
    const getDirectoryHandle = vi.fn().mockResolvedValue(handle);
    const getDirectory = vi.fn().mockResolvedValue({ getDirectoryHandle });

    vi.stubGlobal('navigator', {
      storage: { getDirectory },
    });
    vi.stubGlobal('window', {
      localStorage: {
        getItem: vi.fn().mockReturnValue('e2e-workspace'),
      },
    });

    const provider = new WebWorkspaceProvider(makeStorage() as any);
    await provider.restoreWorkspace();

    expect(getDirectoryHandle).toHaveBeenCalledWith('e2e-workspace', { create: true });
  });

  it('saveWorkspace calls storage.set', async () => {
    const storage = makeStorage();
    const provider = new WebWorkspaceProvider(storage as any);
    const handle = { name: 'test' } as any;
    await provider.saveWorkspace(handle);
    expect(storage.set).toHaveBeenCalledWith(handle);
  });

  it('clearWorkspace calls storage.clear', async () => {
    const storage = makeStorage();
    const provider = new WebWorkspaceProvider(storage as any);
    await provider.clearWorkspace();
    expect(storage.clear).toHaveBeenCalled();
  });
});
