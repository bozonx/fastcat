/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';
import { crossVfsCopy, crossVfsMove } from '~/file-manager/core/vfs/crossVfs';
import type { VfsProgressReporter } from '~/file-manager/core/vfs/types';

function makeReporter(): VfsProgressReporter & {
  handles: Array<{
    update: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    fail: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  }>;
  startMock: ReturnType<typeof vi.fn>;
} {
  const handles: Array<{
    update: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    fail: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  }> = [];
  const start = vi.fn(() => {
    const handle = {
      update: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      cancel: vi.fn(),
    };
    handles.push(handle);
    return handle;
  });
  return { start, handles, startMock: start };
}

describe('crossVfsCopy', () => {
  let source: InMemoryFileSystemAdapter;
  let target: InMemoryFileSystemAdapter;

  beforeEach(() => {
    source = new InMemoryFileSystemAdapter();
    target = new InMemoryFileSystemAdapter();
  });

  describe('files', () => {
    it('copies a small file via streams', async () => {
      await source.writeFile('hello.txt', 'world');
      const result = await crossVfsCopy({
        sourceVfs: source,
        targetVfs: target,
        sourcePath: 'hello.txt',
        sourceKind: 'file',
        targetDirPath: '',
      });
      expect(result).toBe('hello.txt');
      expect(await (await target.readFile('hello.txt')).text()).toBe('world');
    });

    it('sanitizes illegal characters for non-preserving targets', async () => {
      await source.writeFile('a: b * c?.txt', 'x');
      const result = await crossVfsCopy({
        sourceVfs: source,
        targetVfs: target,
        sourcePath: 'a: b * c?.txt',
        sourceKind: 'file',
        targetDirPath: '',
      });
      expect(result).toBe('a- b - c-.txt');
      expect(await target.exists('a- b - c-.txt')).toBe(true);
    });

    it('preserves names when target advertises preservesEntryNames', async () => {
      await source.writeFile('a: b.txt', 'x');
      Object.assign(target, { preservesEntryNames: true });
      const result = await crossVfsCopy({
        sourceVfs: source,
        targetVfs: target,
        sourcePath: 'a: b.txt',
        sourceKind: 'file',
        targetDirPath: '',
      });
      expect(result).toBe('a: b.txt');
      expect(await target.exists('a: b.txt')).toBe(true);
    });

    it('appends a counter to avoid collisions', async () => {
      await source.writeFile('dup.txt', 'A');
      await target.writeFile('dup.txt', 'existing');
      const result = await crossVfsCopy({
        sourceVfs: source,
        targetVfs: target,
        sourcePath: 'dup.txt',
        sourceKind: 'file',
        targetDirPath: '',
      });
      expect(result).toBe('dup (1).txt');
      expect(await (await target.readFile('dup (1).txt')).text()).toBe('A');
      expect(await (await target.readFile('dup.txt')).text()).toBe('existing');
    });

    it('routes the copy under targetDirPath', async () => {
      await source.writeFile('s.txt', 'data');
      await target.createDirectory('outbox');
      const result = await crossVfsCopy({
        sourceVfs: source,
        targetVfs: target,
        sourcePath: 's.txt',
        sourceKind: 'file',
        targetDirPath: 'outbox',
      });
      expect(result).toBe('outbox/s.txt');
      expect(await target.exists('outbox/s.txt')).toBe(true);
    });

    it('reports progress for large files when reporter is supplied', async () => {
      const big = new Uint8Array(11 * 1024 * 1024);
      await source.writeFile('big.bin', big);
      const reporter = makeReporter();

      await crossVfsCopy({
        sourceVfs: source,
        targetVfs: target,
        sourcePath: 'big.bin',
        sourceKind: 'file',
        targetDirPath: '',
        progressReporter: reporter,
      });

      expect(reporter.startMock).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'copy', totalBytes: big.byteLength }),
      );
      expect(reporter.handles[0]!.complete).toHaveBeenCalled();
    });

    it('skips progress UI for small copies', async () => {
      await source.writeFile('tiny.txt', 'x');
      const reporter = makeReporter();
      await crossVfsCopy({
        sourceVfs: source,
        targetVfs: target,
        sourcePath: 'tiny.txt',
        sourceKind: 'file',
        targetDirPath: '',
        progressReporter: reporter,
      });
      expect(reporter.startMock).not.toHaveBeenCalled();
    });

    it('aborts before opening streams when signal is pre-aborted', async () => {
      await source.writeFile('x.txt', 'data');
      const c = new AbortController();
      c.abort();
      const reporter = makeReporter();
      await expect(
        crossVfsCopy({
          sourceVfs: source,
          targetVfs: target,
          sourcePath: 'x.txt',
          sourceKind: 'file',
          targetDirPath: '',
          signal: c.signal,
          progressReporter: reporter,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(reporter.startMock).not.toHaveBeenCalled();
    });

    it('still copies when source vfs has no getMetadata (defensive)', async () => {
      const fake = {
        id: 'fake',
        readStream: async () =>
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new TextEncoder().encode('hello'));
              c.close();
            },
          }),
        // no getMetadata
      } as any;
      const result = await crossVfsCopy({
        sourceVfs: fake,
        targetVfs: target,
        sourcePath: 'some.txt',
        sourceKind: 'file',
        targetDirPath: '',
      });
      expect(result).toBe('some.txt');
      expect(await (await target.readFile('some.txt')).text()).toBe('hello');
    });
  });

  describe('directories', () => {
    it('copies a tree recursively', async () => {
      await source.writeFile('tree/a.txt', 'A');
      await source.writeFile('tree/sub/b.txt', 'B');
      await source.writeFile('tree/sub/deeper/c.txt', 'C');

      const result = await crossVfsCopy({
        sourceVfs: source,
        targetVfs: target,
        sourcePath: 'tree',
        sourceKind: 'directory',
        targetDirPath: '',
      });

      expect(result).toBe('tree');
      expect(await (await target.readFile('tree/a.txt')).text()).toBe('A');
      expect(await (await target.readFile('tree/sub/b.txt')).text()).toBe('B');
      expect(await (await target.readFile('tree/sub/deeper/c.txt')).text()).toBe('C');
    });

    it('renames the top-level directory if the target already has one with that name', async () => {
      await source.writeFile('tree/a.txt', 'A');
      await target.createDirectory('tree');
      const result = await crossVfsCopy({
        sourceVfs: source,
        targetVfs: target,
        sourcePath: 'tree',
        sourceKind: 'directory',
        targetDirPath: '',
      });
      expect(result).toBe('tree (1)');
      expect(await target.exists('tree')).toBe(true);
      expect(await (await target.readFile('tree (1)/a.txt')).text()).toBe('A');
    });

    it('sanitizes child names', async () => {
      await source.writeFile('tree/bad: name.txt', 'X');
      await crossVfsCopy({
        sourceVfs: source,
        targetVfs: target,
        sourcePath: 'tree',
        sourceKind: 'directory',
        targetDirPath: '',
      });
      expect(await target.exists('tree/bad- name.txt')).toBe(true);
    });

    it('honors abort during recursion', async () => {
      await source.writeFile('tree/a.txt', 'A');
      const c = new AbortController();
      c.abort();
      await expect(
        crossVfsCopy({
          sourceVfs: source,
          targetVfs: target,
          sourcePath: 'tree',
          sourceKind: 'directory',
          targetDirPath: '',
          signal: c.signal,
        }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('throws VfsDepthExceededError beyond MAX_COPY_DEPTH', async () => {
      // Build a 60-deep chain
      let path = 'deep';
      await source.createDirectory(path);
      for (let i = 0; i < 60; i++) {
        path += `/level${i}`;
        await source.createDirectory(path);
      }
      await source.writeFile(`${path}/leaf.txt`, 'leaf');

      await expect(
        crossVfsCopy({
          sourceVfs: source,
          targetVfs: target,
          sourcePath: 'deep',
          sourceKind: 'directory',
          targetDirPath: '',
        }),
      ).rejects.toMatchObject({ name: 'VfsDepthExceededError' });
    });
  });
});

describe('crossVfsMove', () => {
  let source: InMemoryFileSystemAdapter;
  let target: InMemoryFileSystemAdapter;

  beforeEach(() => {
    source = new InMemoryFileSystemAdapter();
    target = new InMemoryFileSystemAdapter();
  });

  it('copies then deletes the source on success', async () => {
    await source.writeFile('m.txt', 'data');
    const result = await crossVfsMove({
      sourceVfs: source,
      targetVfs: target,
      sourcePath: 'm.txt',
      sourceKind: 'file',
      targetDirPath: '',
    });
    expect(result).toBe('m.txt');
    expect(await source.exists('m.txt')).toBe(false);
    expect(await target.exists('m.txt')).toBe(true);
  });

  it('leaves the source untouched if the copy fails', async () => {
    await source.writeFile('m.txt', 'data');
    const failingTarget = new InMemoryFileSystemAdapter();
    // Spy on writeStream to throw the first time
    const original = failingTarget.writeStream.bind(failingTarget);
    failingTarget.writeStream = vi.fn(async () => {
      throw new Error('disk full');
    }) as unknown as typeof failingTarget.writeStream;

    await expect(
      crossVfsMove({
        sourceVfs: source,
        targetVfs: failingTarget,
        sourcePath: 'm.txt',
        sourceKind: 'file',
        targetDirPath: '',
      }),
    ).rejects.toThrow();
    expect(await source.exists('m.txt')).toBe(true);

    // restore for sanity
    failingTarget.writeStream = original as typeof failingTarget.writeStream;
  });
});
