import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { createProxyFsModule } from '~/stores/proxy/proxyFs';

vi.mock('~/utils/storage-handles', () => ({
  ensureResolvedProjectProxiesDir: vi.fn(),
}));

describe('createProxyFsModule', () => {
  it('returns a SHA-256 based proxy file name', async () => {
    const module = createProxyFsModule({
      workspaceHandle: ref(null),
      currentProjectId: ref(null),
      resolvedStorageTopology: ref({} as any),
    });
    const name = await module.getProxyFileName('video/test.mp4');
    expect(name).toMatch(/^[0-9a-f]{64}\.mp4$/);
  });

  it('returns null when workspace handle is missing', async () => {
    const { ensureResolvedProjectProxiesDir } = await import('~/utils/storage-handles');
    const module = createProxyFsModule({
      workspaceHandle: ref(null),
      currentProjectId: ref('p1'),
      resolvedStorageTopology: ref({} as any),
    });
    expect(await module.ensureProjectProxiesDir()).toBeNull();
    expect(ensureResolvedProjectProxiesDir).not.toHaveBeenCalled();
  });

  it('returns null when project id is missing', async () => {
    const { ensureResolvedProjectProxiesDir } = await import('~/utils/storage-handles');
    const module = createProxyFsModule({
      workspaceHandle: ref({} as FileSystemDirectoryHandle),
      currentProjectId: ref(null),
      resolvedStorageTopology: ref({} as any),
    });
    expect(await module.ensureProjectProxiesDir()).toBeNull();
    expect(ensureResolvedProjectProxiesDir).not.toHaveBeenCalled();
  });

  it('delegates to ensureResolvedProjectProxiesDir when inputs are present', async () => {
    const { ensureResolvedProjectProxiesDir } = await import('~/utils/storage-handles');
    const mockDir = { name: 'proxies' } as unknown as FileSystemDirectoryHandle;
    vi.mocked(ensureResolvedProjectProxiesDir).mockResolvedValue(mockDir);

    const module = createProxyFsModule({
      workspaceHandle: ref({} as FileSystemDirectoryHandle),
      currentProjectId: ref('p1'),
      resolvedStorageTopology: ref({ type: 'standard' } as any),
    });

    const result = await module.ensureProjectProxiesDir();
    expect(result).toBe(mockDir);
    expect(ensureResolvedProjectProxiesDir).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', create: true }),
    );
  });
});
