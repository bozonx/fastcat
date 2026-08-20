/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterFileSystemAdapter } from '~/file-manager/core/vfs/router.adapter';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';
import type {
  IFileSystemAdapter,
  VfsProgressHandle,
  VfsProgressReporter,
} from '~/file-manager/core/vfs/types';

function createAdapter(overrides: Partial<IFileSystemAdapter>): IFileSystemAdapter {
  const base: IFileSystemAdapter = {
    id: 'adapter',
    init: vi.fn(),
    readDirectory: vi.fn(),
    createDirectory: vi.fn(),
    listEntryNames: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    deleteEntry: vi.fn(),
    moveEntry: vi.fn(),
    copyFile: vi.fn(),
    copyDirectory: vi.fn(),
    exists: vi.fn(),
    getMetadata: vi.fn(),
    getObjectUrl: vi.fn(),
    getFile: vi.fn(),
    readStream: vi.fn(),
    writeStream: vi.fn(),
    writeJson: vi.fn(),
  };
  return { ...base, ...overrides };
}

function makeReporter(): VfsProgressReporter & {
  start: ReturnType<typeof vi.fn>;
  handles: VfsProgressHandle[];
} {
  const handles: VfsProgressHandle[] = [];
  const start = vi.fn(() => {
    const handle: VfsProgressHandle = {
      update: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      cancel: vi.fn(),
    };
    handles.push(handle);
    return handle;
  });
  return { start, handles };
}

describe('RouterFileSystemAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('route resolution', () => {
    it('routes a path to the matching prefix and strips it before delegating', async () => {
      const def = createAdapter({ id: 'default', readFile: vi.fn(async () => new Blob()) });
      const routed = createAdapter({ id: 'routed', readFile: vi.fn(async () => new Blob()) });
      const router = new RouterFileSystemAdapter(def, [
        {
          prefix: '/remote',
          adapter: routed,
          stripPrefix: (path) => path.replace(/^\/remote\/?/, ''),
        },
      ]);

      await router.readFile('/remote/x.txt');
      expect(routed.readFile).toHaveBeenCalledWith('x.txt', undefined);
      expect(def.readFile).not.toHaveBeenCalled();
    });

    it('falls back to the default adapter when no prefix matches', async () => {
      const def = createAdapter({ id: 'default', exists: vi.fn(async () => true) });
      const routed = createAdapter({ id: 'routed', exists: vi.fn(async () => false) });
      const router = new RouterFileSystemAdapter(def, [
        {
          prefix: '/remote',
          adapter: routed,
          stripPrefix: (p) => p.replace(/^\/remote\/?/, ''),
        },
      ]);

      await router.exists('/local/file.txt');
      expect(def.exists).toHaveBeenCalledWith('/local/file.txt');
      expect(routed.exists).not.toHaveBeenCalled();
    });

    it('matches routes by full path segment boundaries (avoids prefix bleed)', async () => {
      const def = createAdapter({ exists: vi.fn(async () => true) });
      const routed = createAdapter({ id: 'routed', exists: vi.fn(async () => false) });
      const router = new RouterFileSystemAdapter(def, [
        {
          prefix: '@common',
          adapter: routed,
          stripPrefix: (p) => p.replace(/^@common\/?/, ''),
        },
      ]);

      await expect(router.exists('@common/file.txt')).resolves.toBe(false);
      await expect(router.exists('@common2/file.txt')).resolves.toBe(true);
      expect(routed.exists).toHaveBeenCalledWith('file.txt');
      expect(def.exists).toHaveBeenCalledWith('@common2/file.txt');
    });

    it('matches the longest prefix first when prefixes overlap', async () => {
      const def = createAdapter({ id: 'default' });
      const shortHit = createAdapter({
        id: 'short',
        exists: vi.fn(async () => false),
      });
      const longHit = createAdapter({
        id: 'long',
        exists: vi.fn(async () => true),
      });

      const router = new RouterFileSystemAdapter(def, [
        { prefix: '/foo', adapter: shortHit, stripPrefix: (p) => p.replace(/^\/foo\/?/, '') },
        {
          prefix: '/foo/bar',
          adapter: longHit,
          stripPrefix: (p) => p.replace(/^\/foo\/bar\/?/, ''),
        },
      ]);

      await router.exists('/foo/bar/baz');
      expect(longHit.exists).toHaveBeenCalledWith('baz');
      expect(shortHit.exists).not.toHaveBeenCalled();
    });

    it('init initializes the default adapter and every route adapter', async () => {
      const def = createAdapter({ init: vi.fn() });
      const route1 = createAdapter({ id: 'r1', init: vi.fn() });
      const route2 = createAdapter({ id: 'r2', init: vi.fn() });
      const router = new RouterFileSystemAdapter(def, [
        { prefix: '/a', adapter: route1, stripPrefix: (p) => p },
        { prefix: '/b', adapter: route2, stripPrefix: (p) => p },
      ]);
      await router.init();
      expect(def.init).toHaveBeenCalled();
      expect(route1.init).toHaveBeenCalled();
      expect(route2.init).toHaveBeenCalled();
    });

    it('registerRoute adds and replaces routes, unregisterRoute removes them', async () => {
      const def = createAdapter({ id: 'default', exists: vi.fn(async () => true) });
      const v1 = createAdapter({ id: 'v1', exists: vi.fn(async () => false) });
      const v2 = createAdapter({ id: 'v2', exists: vi.fn(async () => false) });
      const router = new RouterFileSystemAdapter(def, []);

      router.registerRoute({ prefix: '/r', adapter: v1, stripPrefix: (p) => p });
      await router.exists('/r/x');
      expect(v1.exists).toHaveBeenCalled();

      router.registerRoute({ prefix: '/r', adapter: v2, stripPrefix: (p) => p });
      vi.clearAllMocks();
      await router.exists('/r/x');
      expect(v1.exists).not.toHaveBeenCalled();
      expect(v2.exists).toHaveBeenCalled();

      router.unregisterRoute('/r');
      vi.clearAllMocks();
      await router.exists('/r/x');
      expect(v1.exists).not.toHaveBeenCalled();
      expect(v2.exists).not.toHaveBeenCalled();
      expect(def.exists).toHaveBeenCalledWith('/r/x');
    });
  });

  describe('readDirectory path remapping', () => {
    it('rewrites returned paths to include the route prefix', async () => {
      const routed = new InMemoryFileSystemAdapter();
      await routed.writeFile('a.txt', '');
      await routed.writeFile('sub/b.txt', '');

      const router = new RouterFileSystemAdapter(new InMemoryFileSystemAdapter(), [
        {
          prefix: '@common',
          adapter: routed,
          stripPrefix: (p) => p.replace(/^@common\/?/, ''),
        },
      ]);

      const root = await router.readDirectory('@common');
      const paths = root.map((e) => e.path).sort();
      expect(paths).toEqual(['@common/a.txt', '@common/sub']);

      const sub = await router.readDirectory('@common/sub');
      expect(sub.map((e) => e.path)).toEqual(['@common/sub/b.txt']);
    });

    it('falls through to the default adapter without rewriting', async () => {
      const def = new InMemoryFileSystemAdapter();
      await def.writeFile('plain.txt', '');
      const router = new RouterFileSystemAdapter(def, []);
      const entries = await router.readDirectory('');
      expect(entries.map((e) => e.path)).toEqual(['plain.txt']);
    });
  });

  describe('same-adapter operations', () => {
    let routed: InMemoryFileSystemAdapter;
    let router: RouterFileSystemAdapter;

    beforeEach(async () => {
      routed = new InMemoryFileSystemAdapter();
      router = new RouterFileSystemAdapter(new InMemoryFileSystemAdapter(), [
        {
          prefix: '/r',
          adapter: routed,
          stripPrefix: (p) => p.replace(/^\/r\/?/, ''),
        },
      ]);
      await routed.writeFile('a.txt', 'hello');
    });

    it('delegates moveEntry directly when both ends live on the same adapter', async () => {
      await router.moveEntry('/r/a.txt', '/r/b.txt');
      expect(await routed.exists('a.txt')).toBe(false);
      expect(await (await routed.readFile('b.txt')).text()).toBe('hello');
    });

    it('delegates copyFile directly when both ends live on the same adapter', async () => {
      await router.copyFile('/r/a.txt', '/r/copy.txt');
      expect(await (await routed.readFile('a.txt')).text()).toBe('hello');
      expect(await (await routed.readFile('copy.txt')).text()).toBe('hello');
    });

    it('delegates copyDirectory directly when both ends live on the same adapter', async () => {
      await routed.writeFile('dir/x.txt', 'X');
      await router.copyDirectory('/r/dir', '/r/clone');
      expect(await (await routed.readFile('clone/x.txt')).text()).toBe('X');
    });
  });

  describe('cross-adapter operations', () => {
    let def: InMemoryFileSystemAdapter;
    let routed: InMemoryFileSystemAdapter;
    let router: RouterFileSystemAdapter;

    beforeEach(async () => {
      def = new InMemoryFileSystemAdapter();
      routed = new InMemoryFileSystemAdapter();
      router = new RouterFileSystemAdapter(def, [
        {
          prefix: '/remote',
          adapter: routed,
          stripPrefix: (p) => p.replace(/^\/remote\/?/, ''),
        },
      ]);
    });

    it('copies a file from one adapter to another', async () => {
      await routed.writeFile('src.txt', 'payload');
      await router.copyFile('/remote/src.txt', '/dest.txt');
      expect(await (await def.readFile('dest.txt')).text()).toBe('payload');
      // source untouched
      expect(await routed.exists('src.txt')).toBe(true);
    });

    it('copies a directory tree across adapters with sanitization', async () => {
      await routed.writeFile('tree/a: name.txt', 'A');
      await routed.writeFile('tree/sub/b.txt', 'B');

      await router.copyDirectory('/remote/tree', '/dest');

      // Default in-memory adapter does not sanitize entry names. Either the
      // router-level copyFile delegated to crossVfs (sanitized) or the
      // recursive helper preserved the name. The contract for non-preserving
      // target is sanitization — verify the sanitized path exists.
      expect(await def.exists('dest/a- name.txt')).toBe(true);
      expect(await (await def.readFile('dest/sub/b.txt')).text()).toBe('B');
    });

    it('moves a file across adapters: target appears, source is removed', async () => {
      await routed.writeFile('moveme.txt', 'data');
      await router.moveEntry('/remote/moveme.txt', '/moved.txt');
      expect(await (await def.readFile('moved.txt')).text()).toBe('data');
      expect(await routed.exists('moveme.txt')).toBe(false);
    });

    it('moveEntry refuses to delete the source if the source is missing', async () => {
      await expect(router.moveEntry('/remote/ghost.txt', '/dest.txt')).rejects.toMatchObject({
        name: 'VfsNotFoundError',
      });
    });

    it('aborts a cross-adapter copy when signal is pre-aborted', async () => {
      await routed.writeFile('big.bin', new Uint8Array(11 * 1024 * 1024));
      const reporter = makeReporter();
      router = new RouterFileSystemAdapter(
        def,
        [
          {
            prefix: '/remote',
            adapter: routed,
            stripPrefix: (p) => p.replace(/^\/remote\/?/, ''),
          },
        ],
        { progressReporter: reporter },
      );
      const c = new AbortController();
      c.abort();
      await expect(
        router.copyFile('/remote/big.bin', '/big.bin', { signal: c.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(reporter.start).not.toHaveBeenCalled();
      expect(await def.exists('big.bin')).toBe(false);
    });

    it('reports progress for large cross-adapter copies', async () => {
      await routed.writeFile('big.bin', new Uint8Array(11 * 1024 * 1024));
      const reporter = makeReporter();
      router = new RouterFileSystemAdapter(
        def,
        [
          {
            prefix: '/remote',
            adapter: routed,
            stripPrefix: (p) => p.replace(/^\/remote\/?/, ''),
          },
        ],
        { progressReporter: reporter },
      );
      await router.copyFile('/remote/big.bin', '/big.bin');
      expect(reporter.start).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'copy', totalBytes: 11 * 1024 * 1024 }),
      );
    });

    it('setProgressReporter switches the reporter after construction', async () => {
      await routed.writeFile('big.bin', new Uint8Array(11 * 1024 * 1024));
      router = new RouterFileSystemAdapter(def, [
        {
          prefix: '/remote',
          adapter: routed,
          stripPrefix: (p) => p.replace(/^\/remote\/?/, ''),
        },
      ]);
      const reporter = makeReporter();
      router.setProgressReporter(reporter);
      await router.copyFile('/remote/big.bin', '/big.bin');
      expect(reporter.start).toHaveBeenCalled();
    });
  });
});
