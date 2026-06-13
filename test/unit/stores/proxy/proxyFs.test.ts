import { describe, it, expect, vi } from 'vitest';
import { createProxyFsModule } from '~/stores/proxy/proxyFs';
import type { ResolvedStorageTopology } from '~/utils/storage-topology';

function makeTopology(overrides: Partial<ResolvedStorageTopology> = {}): ResolvedStorageTopology {
  return {
    projectsRoot: 'projects',
    commonRoot: 'common',
    dataRoot: 'data',
    tempRoot: 'vardata',
    proxiesRoot: '',
    ephemeralTmpRoot: '',
    ...overrides,
  };
}

describe('createProxyFsModule', () => {
  it('returns a SHA-256 based proxy file name', async () => {
    const module = createProxyFsModule({
      getProjectId: () => null,
      getResolvedStorageTopology: () => makeTopology(),
    });
    const name = await module.getProxyFileName('video/test.mp4');
    expect(name).toMatch(/^[0-9a-f]{64}\.mp4$/);
  });

  it('normalizes project paths before building proxy file names', async () => {
    const module = createProxyFsModule({
      getProjectId: () => null,
      getResolvedStorageTopology: () => makeTopology(),
    });

    await expect(module.getProxyFileName('./video/./test.mp4')).resolves.toBe(
      await module.getProxyFileName('video/test.mp4'),
    );
  });

  it('returns null VFS path when project id is missing', () => {
    const module = createProxyFsModule({
      getProjectId: () => null,
      getResolvedStorageTopology: () => makeTopology(),
    });
    expect(module.getProjectProxiesVfsPath()).toBeNull();
  });

  it('returns @ptemp proxies path when proxiesRoot is empty', () => {
    const module = createProxyFsModule({
      getProjectId: () => 'p1',
      getResolvedStorageTopology: () => makeTopology({ proxiesRoot: '' }),
    });
    expect(module.getProjectProxiesVfsPath()).toBe('@ptemp/projects/p1/proxies');
  });

  it('returns @pproxies path when proxiesRoot is configured', () => {
    const module = createProxyFsModule({
      getProjectId: () => 'p1',
      getResolvedStorageTopology: () => makeTopology({ proxiesRoot: '/mnt/fast/proxies' }),
    });
    expect(module.getProjectProxiesVfsPath()).toBe('@pproxies/projects/p1');
  });

  it('builds full proxy file path', async () => {
    const module = createProxyFsModule({
      getProjectId: () => 'p1',
      getResolvedStorageTopology: () => makeTopology({ proxiesRoot: '' }),
    });
    const filePath = await module.getProxyFilePath('video/test.mp4');
    expect(filePath).toMatch(/^@ptemp\/projects\/p1\/proxies\/[0-9a-f]{64}\.mp4$/);
  });

  it('returns null proxy file path when project id is missing', async () => {
    const module = createProxyFsModule({
      getProjectId: () => null,
      getResolvedStorageTopology: () => makeTopology(),
    });
    const filePath = await module.getProxyFilePath('video/test.mp4');
    expect(filePath).toBeNull();
  });
});
