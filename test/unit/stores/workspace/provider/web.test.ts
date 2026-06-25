/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { WebWorkspaceProvider } from '~/stores/workspace/provider/web';

describe('WebWorkspaceProvider', () => {
  function makeStorage() {
    return {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
  }

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
