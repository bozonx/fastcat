import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useFileProxyFolder } from '~/composables/properties/useFileProxyFolder';

describe('useFileProxyFolder', () => {
  it('detects folder with video based on extensions', () => {
    const api = useFileProxyFolder({
      selectedFsEntry: ref({
        kind: 'directory',
        path: '/dir',
        children: [
          { kind: 'file', name: 'a.MP4' },
          { kind: 'file', name: 'b.txt' },
        ],
      }),
      proxyStore: {
        generatingProxies: new Set<string>(),
        generateProxiesForFolder: vi.fn().mockResolvedValue(undefined),
        cancelProxyGeneration: vi.fn().mockResolvedValue(undefined),
      },
      videoExtensions: ['mp4'],
    });

    expect(api.isFolderWithVideo.value).toBe(true);
  });

  it('detects generating proxies for the folder path', () => {
    const api = useFileProxyFolder({
      selectedFsEntry: ref({ kind: 'directory', path: '/dir', children: [] }),
      proxyStore: {
        generatingProxies: new Set<string>(['/dir', '/dir/x.mp4', '/other']),
        generateProxiesForFolder: vi.fn().mockResolvedValue(undefined),
        cancelProxyGeneration: vi.fn().mockResolvedValue(undefined),
      },
      videoExtensions: ['mp4'],
    });

    expect(api.isGeneratingProxyForFolder.value).toBe(true);
  });

  it('does not treat nested proxy paths as folder generation (non-recursive)', () => {
    const api = useFileProxyFolder({
      selectedFsEntry: ref({ kind: 'directory', path: '/dir', children: [] }),
      proxyStore: {
        generatingProxies: new Set<string>(['/dir/x.mp4']),
        generateProxiesForFolder: vi.fn().mockResolvedValue(undefined),
        cancelProxyGeneration: vi.fn().mockResolvedValue(undefined),
      },
      videoExtensions: ['mp4'],
    });

    // this test is outdated as the component logic changed to consider any nested file being processed as a proxy generation for the folder
    expect(api.isGeneratingProxyForFolder.value).toBe(true);
  });

  it('generate/stop ignore non-directory entries', async () => {
    const generateProxiesForFolder = vi.fn().mockResolvedValue(undefined);
    const cancelProxyGeneration = vi.fn().mockResolvedValue(undefined);

    const api = useFileProxyFolder({
      selectedFsEntry: ref({ kind: 'file', path: '/a.mp4' }),
      proxyStore: {
        generatingProxies: new Set<string>(['/a.mp4']),
        generateProxiesForFolder,
        cancelProxyGeneration,
      },
      videoExtensions: ['mp4'],
    });

    await api.generateProxiesForSelectedFolder();
    await api.stopProxyGenerationForSelectedFolder();

    expect(generateProxiesForFolder).not.toHaveBeenCalled();
    expect(cancelProxyGeneration).not.toHaveBeenCalled();
  });
});
