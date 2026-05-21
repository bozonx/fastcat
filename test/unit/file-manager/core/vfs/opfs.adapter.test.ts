/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpfsFileSystemAdapter } from '~/file-manager/core/vfs/opfs.adapter';

// ---------- Mocks ----------

function createMockWritable() {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockFile(
  name: string,
  content: string | Uint8Array = '',
  opts: { lastModified?: number } = {},
): File {
  const blob = typeof content === 'string' ? new Blob([content]) : new Blob([content.buffer]);
  return new File([blob], name, {
    lastModified: opts.lastModified ?? Date.now(),
  });
}

interface MockDirEntry {
  name: string;
  kind: 'file' | 'directory';
  handle: MockFileHandle | MockDirectoryHandle;
}

class MockFileSystemWritableFileStream extends WritableStream<Uint8Array> {
  private _writeFn: (chunk: any) => Promise<void>;
  private _closeFn: () => Promise<void>;

  constructor(writeFn: (chunk: any) => Promise<void>, closeFn: () => Promise<void>) {
    super({ write: (c) => writeFn(c), close: () => closeFn() });
    this._writeFn = writeFn;
    this._closeFn = closeFn;
  }

  async write(chunk: any) {
    return this._writeFn(chunk);
  }

  async close() {
    return this._closeFn();
  }
}

class MockFileHandle {
  kind = 'file' as const;
  name: string;
  private content: Uint8Array;
  lastModified: number;

  constructor(name: string, content: string | Uint8Array = '', opts?: { lastModified?: number }) {
    this.name = name;
    this.content = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    this.lastModified = opts?.lastModified ?? Date.now();
  }

  getFile = vi.fn(async (): Promise<File> => {
    return createMockFile(this.name, this.content, { lastModified: this.lastModified });
  });

  createWritable = vi.fn(async () => {
    const chunks: Uint8Array[] = [];
    const write = vi.fn(async (chunk: any) => {
      if (chunk instanceof Uint8Array) {
        chunks.push(chunk);
      } else if (typeof chunk === 'string') {
        chunks.push(new TextEncoder().encode(chunk));
      } else if (ArrayBuffer.isView(chunk)) {
        chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      }
    });
    const close = vi.fn(async () => {
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      this.content = merged;
    });
    return new MockFileSystemWritableFileStream(write, close);
  });

  setContent(content: string | Uint8Array) {
    this.content = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  }
}

class MockDirectoryHandle {
  kind = 'directory' as const;
  name: string;
  private entriesMap = new Map<string, MockFileHandle | MockDirectoryHandle>();

  constructor(name: string, children: Record<string, MockFileHandle | MockDirectoryHandle> = {}) {
    this.name = name;
    for (const [key, value] of Object.entries(children)) {
      this.entriesMap.set(key, value);
    }
  }

  entries = vi.fn(
    async function* () {
      for (const [name, handle] of this.entriesMap) {
        yield [name, handle];
      }
    }.bind(this),
  );

  values = vi.fn(
    async function* () {
      for (const handle of this.entriesMap.values()) {
        yield handle;
      }
    }.bind(this),
  );

  getFileHandle = vi.fn(async (name: string, options?: { create?: boolean }) => {
    const existing = this.entriesMap.get(name);
    if (existing) {
      if (existing.kind === 'directory') {
        const err = new Error('Type mismatch');
        (err as any).name = 'TypeMismatchError';
        throw err;
      }
      return existing as MockFileHandle;
    }
    if (options?.create) {
      const handle = new MockFileHandle(name);
      this.entriesMap.set(name, handle);
      return handle;
    }
    const err = new Error('Not found');
    (err as any).name = 'NotFoundError';
    throw err;
  });

  getDirectoryHandle = vi.fn(async (name: string, options?: { create?: boolean }) => {
    const existing = this.entriesMap.get(name);
    if (existing) {
      if (existing.kind === 'file') {
        const err = new Error('Type mismatch');
        (err as any).name = 'TypeMismatchError';
        throw err;
      }
      return existing as MockDirectoryHandle;
    }
    if (options?.create) {
      const handle = new MockDirectoryHandle(name);
      this.entriesMap.set(name, handle);
      return handle;
    }
    const err = new Error('Not found');
    (err as any).name = 'NotFoundError';
    throw err;
  });

  removeEntry = vi.fn(async (name: string, _options?: { recursive?: boolean }) => {
    if (!this.entriesMap.has(name)) {
      const err = new Error('Not found');
      (err as any).name = 'NotFoundError';
      throw err;
    }
    this.entriesMap.delete(name);
  });

  addChild(name: string, handle: MockFileHandle | MockDirectoryHandle) {
    this.entriesMap.set(name, handle);
  }

  getChild(name: string): MockFileHandle | MockDirectoryHandle | undefined {
    return this.entriesMap.get(name);
  }
}

function createTestRoot() {
  const root = new MockDirectoryHandle('root', {
    video: new MockDirectoryHandle('video', {
      'clip.mp4': new MockFileHandle('clip.mp4', 'video-content'),
    }),
    audio: new MockDirectoryHandle('audio', {
      'track.mp3': new MockFileHandle('track.mp3', 'audio-content'),
    }),
    'text.txt': new MockFileHandle('text.txt', 'hello world'),
  });
  return root;
}

// ---------- Tests ----------

describe('OpfsFileSystemAdapter', () => {
  let root: MockDirectoryHandle;
  let adapter: OpfsFileSystemAdapter;

  beforeEach(() => {
    root = createTestRoot();
    adapter = new OpfsFileSystemAdapter(async () => root as unknown as FileSystemDirectoryHandle);
  });

  describe('init', () => {
    it('is a no-op', async () => {
      await expect(adapter.init()).resolves.toBeUndefined();
    });
  });

  describe('readDirectory', () => {
    it('returns entries for root', async () => {
      const entries = await adapter.readDirectory('/');
      expect(entries.map((e) => e.name).sort()).toEqual(['audio', 'text.txt', 'video']);
      expect(entries.find((e) => e.name === 'text.txt')?.kind).toBe('file');
      expect(entries.find((e) => e.name === 'video')?.kind).toBe('directory');
    });

    it('returns entries for nested directory', async () => {
      const entries = await adapter.readDirectory('video');
      expect(entries.map((e) => e.name)).toEqual(['clip.mp4']);
    });

    it('returns empty array for non-existent path', async () => {
      const entries = await adapter.readDirectory('nonexistent');
      expect(entries).toEqual([]);
    });

    it('computes hasChildren and hasDirectories when checkChildren is true', async () => {
      const entries = await adapter.readDirectory('/', { checkChildren: true });
      const videoEntry = entries.find((e) => e.name === 'video');
      expect(videoEntry?.hasChildren).toBe(true);
      expect(videoEntry?.hasDirectories).toBe(false);

      const textEntry = entries.find((e) => e.name === 'text.txt');
      expect(textEntry?.hasChildren).toBeUndefined();
      expect(textEntry?.hasDirectories).toBeUndefined();
    });

    it('leaves child flags undefined without checkChildren', async () => {
      const entries = await adapter.readDirectory('/');
      const videoEntry = entries.find((e) => e.name === 'video');
      expect(videoEntry?.hasChildren).toBeUndefined();
      expect(videoEntry?.hasDirectories).toBeUndefined();
    });
  });

  describe('writeFile / readFile', () => {
    it('writes and reads a string', async () => {
      await adapter.writeFile('new-file.txt', 'new-content');
      const blob = await adapter.readFile('new-file.txt');
      expect(await blob.text()).toBe('new-content');
    });

    it('writes and reads a Uint8Array', async () => {
      const data = new Uint8Array([1, 2, 3, 4]);
      await adapter.writeFile('binary.bin', data);
      const blob = await adapter.readFile('binary.bin');
      const arrayBuffer = await blob.arrayBuffer();
      expect(new Uint8Array(arrayBuffer)).toEqual(data);
    });

    it('overwrites existing file', async () => {
      await adapter.writeFile('text.txt', 'replaced');
      const blob = await adapter.readFile('text.txt');
      expect(await blob.text()).toBe('replaced');
    });

    it('throws when reading non-existent file', async () => {
      await expect(adapter.readFile('missing.txt')).rejects.toMatchObject({
        name: 'VfsNotFoundError',
        code: 'not-found',
        path: 'missing.txt',
      });
    });

    it('normalizes SharedArrayBuffer-backed Uint8Array', async () => {
      // FileSystemWritableFileStream.write doesn't support SharedArrayBuffer
      const shared = new SharedArrayBuffer(4);
      const view = new Uint8Array(shared);
      view.set([10, 20, 30, 40]);

      await adapter.writeFile('shared.bin', view);
      const blob = await adapter.readFile('shared.bin');
      const arrayBuffer = await blob.arrayBuffer();
      expect(new Uint8Array(arrayBuffer)).toEqual(new Uint8Array([10, 20, 30, 40]));
    });

    it('requests read-write permission before opening a writable stream', async () => {
      const queryPermission = vi.fn(async () => 'prompt' as PermissionState);
      const requestPermission = vi.fn(async () => 'granted' as PermissionState);
      Object.assign(root, { queryPermission, requestPermission });

      await adapter.writeFile('permitted.txt', 'ok');

      expect(queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
      expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
      expect(await (await adapter.readFile('permitted.txt')).text()).toBe('ok');
    });

    it('throws a permission error when read-write permission is denied', async () => {
      Object.assign(root, {
        queryPermission: vi.fn(async () => 'prompt' as PermissionState),
        requestPermission: vi.fn(async () => 'denied' as PermissionState),
      });

      await expect(adapter.writeFile('denied.txt', 'nope')).rejects.toMatchObject({
        name: 'VfsPermissionError',
        code: 'permission',
        path: 'denied.txt',
      });
    });
  });

  describe('createDirectory', () => {
    it('creates a new directory', async () => {
      await adapter.createDirectory('new-dir');
      const entries = await adapter.readDirectory('/');
      expect(entries.some((e) => e.name === 'new-dir' && e.kind === 'directory')).toBe(true);
    });

    it('creates nested directories', async () => {
      await adapter.createDirectory('a/b/c');
      const a = root.getChild('a') as MockDirectoryHandle;
      expect(a).toBeDefined();
      const b = a.getChild('b') as MockDirectoryHandle;
      expect(b).toBeDefined();
      const c = b.getChild('c') as MockDirectoryHandle;
      expect(c).toBeDefined();
    });
  });

  describe('deleteEntry', () => {
    it('deletes an existing file', async () => {
      await adapter.deleteEntry('text.txt');
      expect(await adapter.exists('text.txt')).toBe(false);
    });

    it('deletes an empty directory', async () => {
      await adapter.deleteEntry('audio');
      expect(await adapter.exists('audio')).toBe(false);
    });

    it('silently ignores NotFoundError', async () => {
      await expect(adapter.deleteEntry('missing.txt')).resolves.toBeUndefined();
    });

    it('throws on unexpected errors', async () => {
      const err = new Error('Permission denied');
      (err as any).name = 'NotAllowedError';
      vi.spyOn(root, 'removeEntry').mockImplementationOnce(() => {
        throw err;
      });
      await expect(adapter.deleteEntry('text.txt')).rejects.toThrow('Permission denied');
    });
  });

  describe('exists', () => {
    it('returns true for existing file', async () => {
      expect(await adapter.exists('text.txt')).toBe(true);
    });

    it('returns true for existing directory', async () => {
      expect(await adapter.exists('video')).toBe(true);
    });

    it('returns false for non-existent path', async () => {
      expect(await adapter.exists('ghost')).toBe(false);
    });

    it('returns true for root', async () => {
      expect(await adapter.exists('/')).toBe(true);
    });
  });

  describe('getMetadata', () => {
    it('returns size and lastModified for a file', async () => {
      const meta = await adapter.getMetadata('text.txt');
      expect(meta?.kind).toBe('file');
      expect(meta?.size).toBeGreaterThan(0);
      expect(meta?.lastModified).toBeGreaterThan(0);
    });

    it('returns directory metadata with zero size', async () => {
      const meta = await adapter.getMetadata('video');
      expect(meta?.kind).toBe('directory');
      expect(meta?.size).toBe(0);
    });

    it('returns null for non-existent path', async () => {
      expect(await adapter.getMetadata('ghost')).toBeNull();
    });
  });

  describe('getFile', () => {
    it('returns a File for existing path', async () => {
      const file = await adapter.getFile('text.txt');
      expect(file).toBeInstanceOf(File);
      expect(file?.name).toBe('text.txt');
    });

    it('returns null for non-existent path', async () => {
      expect(await adapter.getFile('ghost')).toBeNull();
    });
  });

  describe('getObjectUrl', () => {
    it('returns a blob URL for a file', async () => {
      const url = await adapter.getObjectUrl('text.txt');
      expect(url).toMatch(/^blob:/);
    });

    it('revokes the previous object URL for the same path', async () => {
      const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

      const firstUrl = await adapter.getObjectUrl('text.txt');
      await adapter.getObjectUrl('text.txt');

      expect(revokeSpy).toHaveBeenCalledWith(firstUrl);
    });
  });

  describe('writeJson / readFile', () => {
    it('serializes JSON with newline and reads it back', async () => {
      const data = { hello: 'world', count: 42 };
      await adapter.writeJson('config.json', data);
      const blob = await adapter.readFile('config.json');
      const text = await blob.text();
      expect(JSON.parse(text)).toEqual(data);
    });
  });

  describe('copyFile', () => {
    it('copies a file to a new path', async () => {
      await adapter.copyFile('text.txt', 'copy.txt');
      expect(await adapter.exists('copy.txt')).toBe(true);
      const blob = await adapter.readFile('copy.txt');
      expect(await blob.text()).toBe('hello world');
    });

    it('throws AbortError when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        adapter.copyFile('text.txt', 'abort.txt', { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('throws when source does not exist', async () => {
      await expect(adapter.copyFile('ghost', 'dest.txt')).rejects.toMatchObject({
        name: 'VfsNotFoundError',
        path: 'ghost',
      });
    });
  });

  describe('copyDirectory', () => {
    it('copies directory recursively', async () => {
      await adapter.copyDirectory('video', 'video-backup');
      expect(await adapter.exists('video-backup/clip.mp4')).toBe(true);
    });

    it('throws when max depth is exceeded', async () => {
      // Build a deeply nested chain
      let current = root;
      for (let i = 0; i < 55; i++) {
        const next = new MockDirectoryHandle(`dir-${i}`);
        current.addChild(`dir-${i}`, next);
        current = next;
      }

      await expect(adapter.copyDirectory('dir-0', 'deep-copy')).rejects.toMatchObject({
        name: 'VfsDepthExceededError',
        code: 'depth-exceeded',
      });
    });

    it('throws AbortError when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        adapter.copyDirectory('video', 'abort-dir', { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('moveEntry', () => {
    it('moves a file using native move API when available', async () => {
      const fileHandle = root.getChild('text.txt') as MockFileHandle;
      const moveSpy = vi.fn().mockResolvedValue(undefined);
      (fileHandle as any).move = moveSpy;

      await adapter.moveEntry('text.txt', 'moved.txt');
      expect(moveSpy).toHaveBeenCalledWith(expect.anything(), 'moved.txt');
    });

    it('falls back to copy+delete when native move is unavailable', async () => {
      const fileHandle = root.getChild('text.txt') as MockFileHandle;
      delete (fileHandle as any).move;

      await adapter.moveEntry('text.txt', 'moved.txt');
      expect(await adapter.exists('text.txt')).toBe(false);
      expect(await adapter.exists('moved.txt')).toBe(true);
    });

    it('falls back for directories too', async () => {
      await adapter.moveEntry('video', 'renamed-video');
      expect(await adapter.exists('video')).toBe(false);
      expect(await adapter.exists('renamed-video/clip.mp4')).toBe(true);
    });

    it('throws when source does not exist', async () => {
      await expect(adapter.moveEntry('ghost', 'dest')).rejects.toMatchObject({
        name: 'VfsNotFoundError',
        path: 'ghost',
      });
    });

    it('throws AbortError on fallback when signal is aborted', async () => {
      const fileHandle = root.getChild('text.txt') as MockFileHandle;
      delete (fileHandle as any).move;

      const controller = new AbortController();
      controller.abort();
      await expect(
        adapter.moveEntry('text.txt', 'abort.txt', { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('readStream / writeStream', () => {
    it('reads file as a stream', async () => {
      const stream = await adapter.readStream('text.txt');
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total = new TextDecoder().decode(concatUint8Arrays(chunks));
      expect(total).toBe('hello world');
    });

    it('writes file via stream', async () => {
      const stream = await adapter.writeStream('streamed.txt');
      const writer = stream.getWriter();
      await writer.write(new TextEncoder().encode('streamed'));
      await writer.close();

      const blob = await adapter.readFile('streamed.txt');
      expect(await blob.text()).toBe('streamed');
    });
  });

  describe('listEntryNames', () => {
    it('returns names only', async () => {
      const names = await adapter.listEntryNames('video');
      expect(names).toEqual(['clip.mp4']);
    });
  });
});

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
