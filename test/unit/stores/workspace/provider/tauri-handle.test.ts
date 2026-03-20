import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TauriFileHandle, TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';
import { readFile, writeFile, stat, exists, mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...args) => Promise.resolve(args.join('/'))),
}));

describe('TauriFileHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes correctly', () => {
    const handle = new TauriFileHandle('/test/file.txt', 'file.txt');
    expect(handle.kind).toBe('file');
    expect(handle.name).toBe('file.txt');
    expect(handle.path).toBe('/test/file.txt');
  });

  it('getFile reads file and returns a File object', async () => {
    const handle = new TauriFileHandle('/test/file.txt', 'file.txt');
    const mockData = new TextEncoder().encode('hello world');
    vi.mocked(readFile).mockResolvedValue(mockData);
    vi.mocked(stat).mockResolvedValue({ mtime: 1234567890 } as any);

    const file = await handle.getFile();
    expect(readFile).toHaveBeenCalledWith('/test/file.txt');
    expect(stat).toHaveBeenCalledWith('/test/file.txt');
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('file.txt');
    expect(file.lastModified).toBe(1234567890);
    const text = await file.text();
    expect(text).toBe('hello world');
  });

  it('getFile falls back to current time if stat fails', async () => {
    const handle = new TauriFileHandle('/test/file.txt', 'file.txt');
    const mockData = new TextEncoder().encode('hello world');
    vi.mocked(readFile).mockResolvedValue(mockData);
    vi.mocked(stat).mockRejectedValue(new Error('stat failed'));

    const before = Date.now();
    const file = await handle.getFile();
    const after = Date.now();

    expect(file.lastModified).toBeGreaterThanOrEqual(before);
    expect(file.lastModified).toBeLessThanOrEqual(after);
  });

  describe('createWritable', () => {
    it('writes string data', async () => {
      const handle = new TauriFileHandle('/test/file.txt', 'file.txt');
      const writable = await handle.createWritable();
      await writable.write('hello');

      expect(writeFile).toHaveBeenCalledWith('/test/file.txt', expect.any(Uint8Array));
      // We know it converts string to Uint8Array
      const callArg = vi.mocked(writeFile).mock.calls[0][1] as Uint8Array;
      expect(new TextDecoder().decode(callArg)).toBe('hello');
    });

    it('writes Uint8Array data', async () => {
      const handle = new TauriFileHandle('/test/file.txt', 'file.txt');
      const writable = await handle.createWritable();
      const data = new Uint8Array([1, 2, 3]);
      await writable.write(data);

      expect(writeFile).toHaveBeenCalledWith('/test/file.txt', data);
    });

    it('writes other data types (Blob)', async () => {
      const handle = new TauriFileHandle('/test/file.txt', 'file.txt');
      const writable = await handle.createWritable();
      const blob = new Blob(['blob data']);
      await writable.write(blob);

      expect(writeFile).toHaveBeenCalledWith('/test/file.txt', expect.any(Uint8Array));
      const callArg = vi.mocked(writeFile).mock.calls[0][1] as Uint8Array;
      expect(new TextDecoder().decode(callArg)).toBe('blob data');
    });

    it('has a close method that resolves', async () => {
      const handle = new TauriFileHandle('/test/file.txt', 'file.txt');
      const writable = await handle.createWritable();
      await expect(writable.close()).resolves.toBeUndefined();
    });
  });
});

describe('TauriDirectoryHandle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes correctly', () => {
    const handle = new TauriDirectoryHandle('/test/dir', 'dir');
    expect(handle.kind).toBe('directory');
    expect(handle.name).toBe('dir');
    expect(handle.path).toBe('/test/dir');
  });

  describe('getDirectoryHandle', () => {
    it('returns handle if directory exists', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(stat).mockResolvedValue({ isDirectory: true } as any);

      const child = await handle.getDirectoryHandle('child');
      expect(join).toHaveBeenCalledWith('/test', 'child');
      expect(exists).toHaveBeenCalledWith('/test/child');
      expect(stat).toHaveBeenCalledWith('/test/child');
      expect(child).toBeInstanceOf(TauriDirectoryHandle);
      expect(child.name).toBe('child');
      expect(child.path).toBe('/test/child');
    });

    it('throws TypeMismatchError if exists but is not directory', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(stat).mockResolvedValue({ isDirectory: false } as any);

      const err = await handle.getDirectoryHandle('child').catch((e) => e);
      expect(err).toBeInstanceOf(DOMException);
      expect(err.name).toBe('TypeMismatchError');
    });

    it('throws NotFoundError if directory does not exist and create is false', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      vi.mocked(exists).mockResolvedValue(false);

      const err = await handle.getDirectoryHandle('child').catch((e) => e);
      expect(err).toBeInstanceOf(DOMException);
      expect(err.name).toBe('NotFoundError');
    });

    it('creates directory if it does not exist and create is true', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      vi.mocked(exists).mockResolvedValue(false);

      const child = await handle.getDirectoryHandle('child', { create: true });
      expect(mkdir).toHaveBeenCalledWith('/test/child', { recursive: true });
      expect(child).toBeInstanceOf(TauriDirectoryHandle);
    });
  });

  describe('getFileHandle', () => {
    it('returns handle if file exists', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(stat).mockResolvedValue({ isDirectory: false } as any);

      const child = await handle.getFileHandle('file.txt');
      expect(join).toHaveBeenCalledWith('/test', 'file.txt');
      expect(exists).toHaveBeenCalledWith('/test/file.txt');
      expect(stat).toHaveBeenCalledWith('/test/file.txt');
      expect(child).toBeInstanceOf(TauriFileHandle);
      expect(child.name).toBe('file.txt');
      expect(child.path).toBe('/test/file.txt');
    });

    it('throws TypeMismatchError if exists but is a directory', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      vi.mocked(exists).mockResolvedValue(true);
      vi.mocked(stat).mockResolvedValue({ isDirectory: true } as any);

      const err = await handle.getFileHandle('file.txt').catch((e) => e);
      expect(err).toBeInstanceOf(DOMException);
      expect(err.name).toBe('TypeMismatchError');
    });

    it('throws NotFoundError if file does not exist and create is false', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      vi.mocked(exists).mockResolvedValue(false);

      const err = await handle.getFileHandle('file.txt').catch((e) => e);
      expect(err).toBeInstanceOf(DOMException);
      expect(err.name).toBe('NotFoundError');
    });

    it('creates file if it does not exist and create is true', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      vi.mocked(exists).mockResolvedValue(false);

      const child = await handle.getFileHandle('file.txt', { create: true });
      expect(writeFile).toHaveBeenCalledWith('/test/file.txt', new Uint8Array());
      expect(child).toBeInstanceOf(TauriFileHandle);
    });
  });

  describe('removeEntry', () => {
    it('removes file or directory', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      await handle.removeEntry('item', { recursive: true });

      expect(join).toHaveBeenCalledWith('/test', 'item');
      expect(remove).toHaveBeenCalledWith('/test/item', { recursive: true });
    });
  });

  describe('iteration (values and entries)', () => {
    it('yields handles for directory contents', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      vi.mocked(readDir).mockResolvedValue([
        { name: 'dir1', isDirectory: true } as any,
        { name: 'file1.txt', isDirectory: false } as any,
      ]);

      const values = [];
      for await (const val of handle.values()) {
        values.push(val);
      }

      expect(readDir).toHaveBeenCalledWith('/test');
      expect(values).toHaveLength(2);
      expect(values[0]).toBeInstanceOf(TauriDirectoryHandle);
      expect(values[0].name).toBe('dir1');
      expect(values[0].path).toBe('/test/dir1');

      expect(values[1]).toBeInstanceOf(TauriFileHandle);
      expect(values[1].name).toBe('file1.txt');
      expect(values[1].path).toBe('/test/file1.txt');
    });

    it('yields entries for directory contents', async () => {
      const handle = new TauriDirectoryHandle('/test', 'test');
      vi.mocked(readDir).mockResolvedValue([{ name: 'file1.txt', isDirectory: false } as any]);

      const entries = [];
      for await (const entry of handle.entries()) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(1);
      expect(entries[0][0]).toBe('file1.txt');
      expect(entries[0][1]).toBeInstanceOf(TauriFileHandle);
    });
  });
});
