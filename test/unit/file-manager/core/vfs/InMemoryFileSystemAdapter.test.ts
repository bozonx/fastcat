/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';

describe('InMemoryFileSystemAdapter', () => {
  let vfs: InMemoryFileSystemAdapter;

  beforeEach(() => {
    vfs = new InMemoryFileSystemAdapter();
  });

  describe('init', () => {
    it('is a no-op', async () => {
      await expect(vfs.init()).resolves.toBeUndefined();
    });
  });

  describe('writeFile / readFile', () => {
    it('writes and reads a string', async () => {
      await vfs.writeFile('hello.txt', 'world');
      const blob = await vfs.readFile('hello.txt');
      expect(await blob.text()).toBe('world');
    });

    it('writes and reads a Uint8Array (copy, not a view)', async () => {
      const original = new Uint8Array([1, 2, 3]);
      await vfs.writeFile('bin', original);
      original.set([9, 9, 9]); // mutate after the write
      const blob = await vfs.readFile('bin');
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('writes and reads a Blob', async () => {
      await vfs.writeFile('blob', new Blob(['payload'], { type: 'application/json' }));
      const blob = await vfs.readFile('blob');
      expect(await blob.text()).toBe('payload');
      expect(blob.type).toBe('application/json');
    });

    it('overwrites existing content', async () => {
      await vfs.writeFile('a', 'one');
      await vfs.writeFile('a', 'two');
      expect(await (await vfs.readFile('a')).text()).toBe('two');
    });

    it('creates intermediate directories on write', async () => {
      await vfs.writeFile('a/b/c.txt', 'nested');
      expect(await vfs.exists('a/b')).toBe(true);
      expect(await vfs.exists('a/b/c.txt')).toBe(true);
    });

    it('throws VfsNotFoundError when reading missing path', async () => {
      await expect(vfs.readFile('missing')).rejects.toMatchObject({ name: 'VfsNotFoundError' });
    });

    it('honors abort signal at write boundary', async () => {
      const c = new AbortController();
      c.abort();
      await expect(vfs.writeFile('x', 'y', { signal: c.signal })).rejects.toMatchObject({
        name: 'AbortError',
      });
    });
  });

  describe('createDirectory', () => {
    it('creates nested directories', async () => {
      await vfs.createDirectory('one/two/three');
      expect(await vfs.exists('one/two/three')).toBe(true);
    });

    it('is idempotent for existing directories', async () => {
      await vfs.createDirectory('x');
      await expect(vfs.createDirectory('x')).resolves.toBeUndefined();
    });

    it('throws VfsConflictError when target path is a file', async () => {
      await vfs.writeFile('file', 'data');
      await expect(vfs.createDirectory('file')).rejects.toMatchObject({
        name: 'VfsConflictError',
      });
    });
  });

  describe('readDirectory', () => {
    it('returns entries with kind, name, path', async () => {
      await vfs.writeFile('a.txt', '');
      await vfs.createDirectory('sub');
      const entries = await vfs.readDirectory('');
      expect(entries.map((e) => `${e.kind}:${e.name}`).sort()).toEqual(['directory:sub', 'file:a.txt']);
    });

    it('returns empty for unknown nested path', async () => {
      expect(await vfs.readDirectory('ghost/deep')).toEqual([]);
    });

    it('returns empty for unknown root child', async () => {
      expect(await vfs.readDirectory('ghost')).toEqual([]);
    });

    it('propagates abort', async () => {
      const c = new AbortController();
      c.abort();
      await expect(vfs.readDirectory('/', { signal: c.signal })).rejects.toMatchObject({
        name: 'AbortError',
      });
    });
  });

  describe('listEntryNames', () => {
    it('returns names', async () => {
      await vfs.writeFile('a', '');
      await vfs.writeFile('b', '');
      expect((await vfs.listEntryNames('')).sort()).toEqual(['a', 'b']);
    });

    it('returns empty for files', async () => {
      await vfs.writeFile('f', '');
      expect(await vfs.listEntryNames('f')).toEqual([]);
    });
  });

  describe('deleteEntry', () => {
    it('removes a file', async () => {
      await vfs.writeFile('z', '');
      await vfs.deleteEntry('z');
      expect(await vfs.exists('z')).toBe(false);
    });

    it('removes an empty directory', async () => {
      await vfs.createDirectory('empty');
      await vfs.deleteEntry('empty');
      expect(await vfs.exists('empty')).toBe(false);
    });

    it('throws VfsConflictError for non-empty directory without recursive', async () => {
      await vfs.writeFile('full/x', '');
      await expect(vfs.deleteEntry('full')).rejects.toMatchObject({ name: 'VfsConflictError' });
    });

    it('removes non-empty directory when recursive is true', async () => {
      await vfs.writeFile('full/x', '');
      await vfs.deleteEntry('full', true);
      expect(await vfs.exists('full')).toBe(false);
    });

    it('is a no-op for missing paths', async () => {
      await expect(vfs.deleteEntry('ghost')).resolves.toBeUndefined();
      await expect(vfs.deleteEntry('ghost/deep')).resolves.toBeUndefined();
    });
  });

  describe('moveEntry', () => {
    it('moves a file', async () => {
      await vfs.writeFile('a', 'data');
      await vfs.moveEntry('a', 'b');
      expect(await vfs.exists('a')).toBe(false);
      expect(await (await vfs.readFile('b')).text()).toBe('data');
    });

    it('moves a directory', async () => {
      await vfs.writeFile('src/x', '');
      await vfs.moveEntry('src', 'dst');
      expect(await vfs.exists('src')).toBe(false);
      expect(await vfs.exists('dst/x')).toBe(true);
    });

    it('throws VfsNotFoundError when source is missing', async () => {
      await expect(vfs.moveEntry('ghost', 'wherever')).rejects.toMatchObject({
        name: 'VfsNotFoundError',
      });
    });

    it('throws VfsConflictError when target exists', async () => {
      await vfs.writeFile('a', '');
      await vfs.writeFile('b', '');
      await expect(vfs.moveEntry('a', 'b')).rejects.toMatchObject({ name: 'VfsConflictError' });
    });
  });

  describe('copyFile / copyDirectory', () => {
    it('copies a file', async () => {
      await vfs.writeFile('src', 'data');
      await vfs.copyFile('src', 'dst');
      expect(await (await vfs.readFile('dst')).text()).toBe('data');
      expect(await vfs.exists('src')).toBe(true);
    });

    it('copies a directory recursively', async () => {
      await vfs.writeFile('tree/a.txt', 'A');
      await vfs.writeFile('tree/sub/b.txt', 'B');
      await vfs.copyDirectory('tree', 'clone');
      expect(await (await vfs.readFile('clone/a.txt')).text()).toBe('A');
      expect(await (await vfs.readFile('clone/sub/b.txt')).text()).toBe('B');
    });

    it('throws VfsNotFoundError when source file is missing', async () => {
      await expect(vfs.copyFile('ghost', 'dst')).rejects.toMatchObject({
        name: 'VfsNotFoundError',
      });
    });

    it('throws VfsNotFoundError when source directory is missing', async () => {
      await expect(vfs.copyDirectory('ghost', 'dst')).rejects.toMatchObject({
        name: 'VfsNotFoundError',
      });
    });

    it('propagates abort during recursive copy', async () => {
      await vfs.writeFile('tree/a.txt', 'A');
      const c = new AbortController();
      c.abort();
      await expect(vfs.copyDirectory('tree', 'clone', { signal: c.signal })).rejects.toMatchObject({
        name: 'AbortError',
      });
    });
  });

  describe('exists / getMetadata', () => {
    it('reports correct existence for root, file, directory, missing', async () => {
      await vfs.writeFile('f', '');
      await vfs.createDirectory('d');
      expect(await vfs.exists('')).toBe(true);
      expect(await vfs.exists('f')).toBe(true);
      expect(await vfs.exists('d')).toBe(true);
      expect(await vfs.exists('ghost')).toBe(false);
    });

    it('returns size/lastModified for files', async () => {
      const before = Date.now();
      await vfs.writeFile('f', 'abcd');
      const meta = await vfs.getMetadata('f');
      expect(meta?.kind).toBe('file');
      expect(meta?.size).toBe(4);
      expect(meta?.lastModified).toBeGreaterThanOrEqual(before);
    });

    it('returns null for missing paths', async () => {
      expect(await vfs.getMetadata('ghost')).toBeNull();
      expect(await vfs.getMetadata('ghost/deep')).toBeNull();
    });
  });

  describe('getObjectUrl / getFile', () => {
    it('returns a blob URL and revokes the previous URL for the same path', async () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL');
      await vfs.writeFile('x', 'abc');
      const first = await vfs.getObjectUrl('x');
      await vfs.getObjectUrl('x');
      expect(revoke).toHaveBeenCalledWith(first);
    });

    it('revokes URL on delete and write', async () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL');
      await vfs.writeFile('y', 'one');
      const url = await vfs.getObjectUrl('y');
      await vfs.writeFile('y', 'two');
      expect(revoke).toHaveBeenCalledWith(url);

      const url2 = await vfs.getObjectUrl('y');
      await vfs.deleteEntry('y');
      expect(revoke).toHaveBeenCalledWith(url2);
    });

    it('returns null when getFile target is missing or not a file', async () => {
      await vfs.createDirectory('d');
      expect(await vfs.getFile('ghost')).toBeNull();
      expect(await vfs.getFile('d')).toBeNull();
    });

    it('returns a File for an existing path', async () => {
      await vfs.writeFile('z.txt', 'hi');
      const file = await vfs.getFile('z.txt');
      expect(file).toBeInstanceOf(File);
      expect(file?.name).toBe('z.txt');
    });
  });

  describe('streams', () => {
    it('reads via readStream', async () => {
      await vfs.writeFile('s', 'stream-data');
      const stream = await vfs.readStream('s');
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const merged = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      expect(new TextDecoder().decode(merged)).toBe('stream-data');
    });

    it('writes via writeStream', async () => {
      const stream = await vfs.writeStream('w');
      const writer = stream.getWriter();
      await writer.write(new TextEncoder().encode('chunk-1'));
      await writer.write(new TextEncoder().encode('-chunk-2'));
      await writer.close();
      expect(await (await vfs.readFile('w')).text()).toBe('chunk-1-chunk-2');
    });
  });

  describe('writeJson', () => {
    it('serializes objects', async () => {
      await vfs.writeJson('cfg.json', { hello: 'world' });
      expect(JSON.parse(await (await vfs.readFile('cfg.json')).text())).toEqual({
        hello: 'world',
      });
    });
  });
});
