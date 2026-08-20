// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';
import { RouterFileSystemAdapter } from '~/file-manager/core/vfs/router.adapter';

function stripPrefix(prefix: string) {
  return (path: string): string => {
    if (path === prefix) return '';
    return path.slice(prefix.length + 1);
  };
}

describe('file-manager provider routing contracts', () => {
  it('copies and moves entries across project/common/config providers without losing route paths', async () => {
    const workspace = new InMemoryFileSystemAdapter();
    const project = new InMemoryFileSystemAdapter();
    const common = new InMemoryFileSystemAdapter();
    const config = new InMemoryFileSystemAdapter();
    const progress = {
      update: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      cancel: vi.fn(),
    };
    const router = new RouterFileSystemAdapter(
      workspace,
      [
        { prefix: '@project', adapter: project, stripPrefix: stripPrefix('@project') },
        { prefix: '@common', adapter: common, stripPrefix: stripPrefix('@common') },
        { prefix: '@config', adapter: config, stripPrefix: stripPrefix('@config') },
      ],
      {
        progressReporter: {
          start: vi.fn(() => progress),
        },
      },
    );

    await router.writeFile('@project/Demo/media/source.txt', 'source');
    await router.copyFile('@project/Demo/media/source.txt', '@common/library/source.txt');
    await router.moveEntry('@common/library/source.txt', '@project/Demo/imported/source.txt');
    await router.writeJson('@config/app.settings.json', { storage: { mode: 'system' } });

    expect(await project.exists('Demo/media/source.txt')).toBe(true);
    expect(await project.exists('Demo/imported/source.txt')).toBe(true);
    expect(await common.exists('library/source.txt')).toBe(false);
    expect(await config.exists('app.settings.json')).toBe(true);
    expect(await (await router.readFile('@project/Demo/imported/source.txt')).text()).toBe(
      'source',
    );

    const projectEntries = await router.readDirectory('@project/Demo/imported');
    expect(projectEntries).toEqual([
      expect.objectContaining({
        name: 'source.txt',
        path: '@project/Demo/imported/source.txt',
        parentPath: '@project/Demo/imported',
      }),
    ]);
  });
});
