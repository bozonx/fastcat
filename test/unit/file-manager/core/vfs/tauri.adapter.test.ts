/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TAURI_APP_DATA_BASE_PATH,
  TauriFileSystemAdapter,
} from '~/file-manager/core/vfs/tauri.adapter';
import {
  BaseDirectory,
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  remove,
  rename,
  stat,
  writeFile,
} from '@tauri-apps/plugin-fs';
import { appDataDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import { openReadFileStream, openWriteFileStream } from 'tauri-plugin-fs-stream-api';

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 4 },
  copyFile: vi.fn(),
  exists: vi.fn(),
  mkdir: vi.fn(),
  readDir: vi.fn(),
  readFile: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/AppData'),
  join: vi.fn(async (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/')),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((p: string) => `asset://${p}`),
}));

vi.mock('tauri-plugin-fs-stream-api', () => ({
  openReadFileStream: vi.fn(),
  openWriteFileStream: vi.fn(),
}));

vi.mock('~/file-manager/core/path', () => ({
  normalizeFsPath: vi.fn((p: string) => {
    // Collapse repeated slashes and strip leading/trailing slash without
    // crossing the root, matching the production behavior we depend on.
    const cleaned = p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
    return cleaned;
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Pretend we are in Tauri so `init()` doesn't throw.
  (globalThis as unknown as { window: object }).window = { __TAURI_INTERNALS__: {} };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: object }).window;
});

describe('TauriFileSystemAdapter', () => {
  describe('base resolution', () => {
    it('uses AppData when base is the magic string', async () => {
      const adapter = new TauriFileSystemAdapter(TAURI_APP_DATA_BASE_PATH);
      await adapter.init();
      expect(mkdir).toHaveBeenCalledWith('', { baseDir: BaseDirectory.AppData, recursive: true });
    });

    it('uses an absolute base path otherwise', async () => {
      const adapter = new TauriFileSystemAdapter('/abs/root');
      await adapter.init();
      expect(mkdir).toHaveBeenCalledWith('/abs/root', { baseDir: undefined, recursive: true });
    });

    it('accepts a lazy resolver returning an absolute path string', async () => {
      const adapter = new TauriFileSystemAdapter(() => '/lazy/root');
      await adapter.init();
      expect(mkdir).toHaveBeenCalledWith('/lazy/root', { baseDir: undefined, recursive: true });
    });

    it('accepts a TauriBase discriminated union', async () => {
      const adapter = new TauriFileSystemAdapter({ type: 'app-data' });
      await adapter.init();
      expect(mkdir).toHaveBeenCalledWith('', { baseDir: BaseDirectory.AppData, recursive: true });
    });

    it('init throws outside of a Tauri environment', async () => {
      delete (globalThis as unknown as { window?: object }).window;
      const adapter = new TauriFileSystemAdapter('/x');
      await expect(adapter.init()).rejects.toThrow('Not running in Tauri environment');
    });
  });

  describe('readDirectory', () => {
    it('returns mapped entries with paths under the requested prefix', async () => {
      vi.mocked(readDir).mockResolvedValue([
        { name: 'a.txt', isFile: true, isDirectory: false } as any,
        { name: 'sub', isFile: false, isDirectory: true } as any,
      ]);
      const adapter = new TauriFileSystemAdapter('/root');
      const entries = await adapter.readDirectory('docs');
      expect(entries.map((e) => `${e.kind}:${e.path}`).sort()).toEqual([
        'directory:docs/sub',
        'file:docs/a.txt',
      ]);
    });

    it('returns an empty array when the directory is missing', async () => {
      vi.mocked(readDir).mockRejectedValue(Object.assign(new Error('os error 2'), { code: 'ENOENT' }));
      const adapter = new TauriFileSystemAdapter('/root');
      expect(await adapter.readDirectory('missing')).toEqual([]);
    });

    it('checkChildren probes sub-directories for emptiness', async () => {
      vi.mocked(readDir)
        .mockResolvedValueOnce([
          { name: 'has-stuff', isFile: false, isDirectory: true } as any,
          { name: 'empty', isFile: false, isDirectory: true } as any,
        ])
        .mockResolvedValueOnce([{ name: 'inner.txt', isFile: true, isDirectory: false } as any])
        .mockResolvedValueOnce([]);

      const adapter = new TauriFileSystemAdapter('/root');
      const entries = await adapter.readDirectory('docs', { checkChildren: true });
      const byName = Object.fromEntries(entries.map((e) => [e.name, e] as const));
      expect(byName['has-stuff'].hasChildren).toBe(true);
      expect(byName['has-stuff'].hasDirectories).toBe(false);
      expect(byName.empty.hasChildren).toBe(false);
    });

    it('honors abort before issuing readDir', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      const c = new AbortController();
      c.abort();
      await expect(adapter.readDirectory('docs', { signal: c.signal })).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(readDir).not.toHaveBeenCalled();
    });
  });

  describe('writeFile (atomic temp + rename)', () => {
    it('writes a temp file, renames into place, and tolerates a missing dir', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(writeFile).mockResolvedValue();
      vi.mocked(rename).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      await adapter.writeFile('docs/x.txt', 'hello');

      // Temp file was created in the same directory and then renamed.
      const writeCall = vi.mocked(writeFile).mock.calls[0]!;
      expect(writeCall[0]).toMatch(/^\/root\/docs\/\..*\.tmp$/);
      expect(writeCall[1]).toEqual(new TextEncoder().encode('hello'));
      const renameCall = vi.mocked(rename).mock.calls[0]!;
      expect(renameCall[0]).toMatch(/^\/root\/docs\/\..*\.tmp$/);
      expect(renameCall[1]).toBe('/root/docs/x.txt');
    });

    it('cleans up the temp file when the rename fails', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(writeFile).mockResolvedValue();
      vi.mocked(rename).mockRejectedValue(new Error('rename failed'));

      await expect(adapter.writeFile('docs/x.txt', 'hello')).rejects.toThrow();
      expect(remove).toHaveBeenCalled();
    });

    it('rejects empty filenames', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      await expect(adapter.writeFile('', 'data')).rejects.toMatchObject({
        name: 'VfsInvalidArgumentError',
      });
    });
  });

  describe('readFile', () => {
    it('returns a Blob with the file bytes', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(readFile).mockResolvedValue(new TextEncoder().encode('payload'));
      const blob = await adapter.readFile('docs/a.txt');
      expect(await blob.text()).toBe('payload');
    });

    it('maps missing files to VfsNotFoundError', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('os error 2')));
      await expect(adapter.readFile('ghost')).rejects.toMatchObject({ name: 'VfsNotFoundError' });
    });
  });

  describe('moveEntry', () => {
    it('uses native rename when filesystems are compatible', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(rename).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();
      await adapter.moveEntry('a.txt', 'b.txt');
      expect(rename).toHaveBeenCalled();
      expect(copyFile).not.toHaveBeenCalled();
    });

    it('falls back to copy+delete on EXDEV for files', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(rename).mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
      vi.mocked(stat).mockResolvedValue({
        size: 10,
        mtime: 0,
        isDirectory: false,
      } as any);
      vi.mocked(copyFile).mockResolvedValue();
      vi.mocked(remove).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();

      await adapter.moveEntry('a.txt', 'b.txt');
      expect(copyFile).toHaveBeenCalled();
      expect(remove).toHaveBeenCalled();
    });

    it('falls back to copyDirectory+delete on EXDEV for directories', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(rename).mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' }));
      vi.mocked(stat).mockResolvedValue({
        size: 0,
        mtime: 0,
        isDirectory: true,
      } as any);
      vi.mocked(readDir).mockResolvedValue([]);
      vi.mocked(mkdir).mockResolvedValue();
      vi.mocked(remove).mockResolvedValue();
      await adapter.moveEntry('dir', 'dst');
      expect(mkdir).toHaveBeenCalled();
      expect(remove).toHaveBeenCalled();
    });

    it('maps missing source to VfsNotFoundError', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(rename).mockRejectedValue(Object.assign(new Error('os error 2')));
      vi.mocked(mkdir).mockResolvedValue();
      await expect(adapter.moveEntry('ghost', 'wherever')).rejects.toMatchObject({
        name: 'VfsNotFoundError',
      });
    });
  });

  describe('copyFile', () => {
    it('delegates to plugin-fs copyFile', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(copyFile).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();
      await adapter.copyFile('a.txt', 'b.txt');
      expect(copyFile).toHaveBeenCalledWith('/root/a.txt', '/root/b.txt', {
        fromPathBaseDir: undefined,
        toPathBaseDir: undefined,
      });
    });

    it('maps missing source to VfsNotFoundError', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(copyFile).mockRejectedValue(Object.assign(new Error('os error 2')));
      vi.mocked(mkdir).mockResolvedValue();
      await expect(adapter.copyFile('ghost', 'dst')).rejects.toMatchObject({
        name: 'VfsNotFoundError',
      });
    });
  });

  describe('deleteEntry', () => {
    it('removes the entry and ignores missing paths', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(remove).mockResolvedValue();
      await adapter.deleteEntry('a.txt');
      expect(remove).toHaveBeenCalledWith('/root/a.txt', { baseDir: undefined, recursive: undefined });

      vi.mocked(remove).mockRejectedValueOnce(Object.assign(new Error('os error 2')));
      await expect(adapter.deleteEntry('ghost')).resolves.toBeUndefined();
    });

    it('forwards recursive flag', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(remove).mockResolvedValue();
      await adapter.deleteEntry('dir', true);
      expect(remove).toHaveBeenCalledWith('/root/dir', { baseDir: undefined, recursive: true });
    });
  });

  describe('exists / getMetadata', () => {
    it('exists returns true/false from plugin-fs', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(exists).mockResolvedValueOnce(true);
      expect(await adapter.exists('a.txt')).toBe(true);
      vi.mocked(exists).mockResolvedValueOnce(false);
      expect(await adapter.exists('b.txt')).toBe(false);
    });

    it('exists swallows not-found errors', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(exists).mockRejectedValue(Object.assign(new Error('os error 2')));
      expect(await adapter.exists('ghost')).toBe(false);
    });

    it('getMetadata maps stat output; missing mtime resolves to 0 (no Date.now lie)', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(stat).mockResolvedValue({
        size: 5,
        mtime: null,
        birthtime: null,
        isDirectory: true,
      } as any);
      const meta = await adapter.getMetadata('dir');
      expect(meta).toEqual({
        size: 5,
        lastModified: 0,
        createdAt: undefined,
        kind: 'directory',
      });
    });

    it('getMetadata returns null when entry is missing', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(stat).mockRejectedValue(Object.assign(new Error('os error 2')));
      expect(await adapter.getMetadata('ghost')).toBeNull();
    });
  });

  describe('getObjectUrl / streams', () => {
    it('builds an asset URL via convertFileSrc with a version query', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(stat).mockResolvedValue({
        size: 1,
        mtime: 1700000000,
        isDirectory: false,
      } as any);
      const url = await adapter.getObjectUrl('docs/a.txt');
      expect(convertFileSrc).toHaveBeenCalledWith('/root/docs/a.txt');
      expect(url).toBe('asset:///root/docs/a.txt?v=1700000000');
    });

    it('resolves stream paths under appDataDir when using AppData base', async () => {
      const adapter = new TauriFileSystemAdapter(TAURI_APP_DATA_BASE_PATH);
      vi.mocked(openReadFileStream).mockResolvedValue(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.close();
          },
        }),
      );
      await adapter.readStream('docs/a.txt');
      expect(appDataDir).toHaveBeenCalled();
      expect(openReadFileStream).toHaveBeenCalledWith('/AppData/docs/a.txt');
    });

    it('ensures parent directory before opening a write stream', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(mkdir).mockResolvedValue();
      vi.mocked(openWriteFileStream).mockResolvedValue(
        new WritableStream<Uint8Array>({
          write: () => {},
        }),
      );
      await adapter.writeStream('docs/x.bin');
      expect(mkdir).toHaveBeenCalled();
      expect(openWriteFileStream).toHaveBeenCalledWith('/root/docs/x.bin');
    });

    it('honors abort before opening streams', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      const c = new AbortController();
      c.abort();
      await expect(adapter.readStream('docs/x.bin', { signal: c.signal })).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(openReadFileStream).not.toHaveBeenCalled();
    });
  });

  describe('writeJson', () => {
    it('writes a serialized JSON payload via writeFile', async () => {
      const adapter = new TauriFileSystemAdapter('/root');
      vi.mocked(writeFile).mockResolvedValue();
      vi.mocked(rename).mockResolvedValue();
      vi.mocked(mkdir).mockResolvedValue();
      await adapter.writeJson('cfg.json', { a: 1 });
      const writeCall = vi.mocked(writeFile).mock.calls[0]!;
      const bytes = writeCall[1] as Uint8Array;
      expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({ a: 1 });
    });
  });

  it('asserts join was used during base resolution', async () => {
    const adapter = new TauriFileSystemAdapter('/root');
    vi.mocked(mkdir).mockResolvedValue();
    await adapter.createDirectory('a/b');
    expect(join).toHaveBeenCalled();
  });
});
