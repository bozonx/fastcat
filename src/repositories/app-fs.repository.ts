import {
  isTransientWriteError,
  runResilientFileWrite,
  withFileIoSlot,
} from '~/utils/io/io-governor';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { VfsNotFoundError } from '~/file-manager/core/vfs/errors';

export type FileHandleLike = Pick<FileSystemFileHandle, 'getFile' | 'createWritable'>;

export type DirectoryHandleLike = Pick<
  FileSystemDirectoryHandle,
  'getDirectoryHandle' | 'getFileHandle' | 'removeEntry'
> & {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
};

export interface AppFsRepository {
  ensureAppFileHandle: (input: {
    baseDir: DirectoryHandleLike;
    filename: string;
    create: boolean;
    folderName?: string;
  }) => Promise<FileHandleLike | null>;
  readJsonFromFileHandle: <T>(handle: FileHandleLike) => Promise<T | null>;
  writeJsonToFileHandle: (input: { handle: FileHandleLike; data: unknown }) => Promise<void>;
}

/**
 * VFS-native JSON store. Replaces the handle-based {@link AppFsRepository} for
 * migrated call sites: paths are routed through the application VFS adapter
 * (atomic temp+rename writes, I/O-governed, typed errors) instead of walking
 * `FileSystemDirectoryHandle`s.
 */
export interface AppFsJsonStore {
  /** Read+parse JSON at `path`. Returns null if the file is missing or empty. */
  readJson<T>(path: string): Promise<T | null>;
  /** Atomically write `data` as pretty JSON at `path`. */
  writeJson(path: string, data: unknown): Promise<void>;
}

const JSON_WRITE_ATTEMPTS = 6;
const JSON_WRITE_BASE_DELAY_MS = 200;

export function createAppFsJsonStore(vfs: IFileSystemAdapter): AppFsJsonStore {
  return {
    async readJson<T>(path: string): Promise<T | null> {
      let blob: Blob;
      try {
        blob = await withFileIoSlot(() => vfs.readFile(path));
      } catch (error) {
        if (error instanceof VfsNotFoundError) return null;
        throw error;
      }
      const text = (await blob.text()).trim();
      if (!text) return null;
      return JSON.parse(text) as T;
    },

    async writeJson(path: string, data: unknown): Promise<void> {
      if (data === undefined) {
        throw new Error('Refusing to write undefined to JSON file');
      }
      // The adapter already acquires an I/O slot and writes atomically, so we
      // retry transient datapipe exhaustion *without* an outer slot — nesting
      // `withFileIoSlot` around a self-governing call could deadlock the budget.
      let lastError: unknown;
      for (let attempt = 0; attempt < JSON_WRITE_ATTEMPTS; attempt += 1) {
        try {
          await vfs.writeJson(path, data);
          return;
        } catch (error) {
          lastError = error;
          if (attempt === JSON_WRITE_ATTEMPTS - 1 || !isTransientWriteError(error)) {
            throw error;
          }
          await new Promise<void>((resolve) =>
            setTimeout(resolve, JSON_WRITE_BASE_DELAY_MS * 2 ** attempt),
          );
        }
      }
      throw lastError;
    },
  };
}

const JSON_WRITE_CHUNK_SIZE = 512 * 1024;

async function writeTextToWritableFileStream(
  writable: FileSystemWritableFileStream,
  text: string,
): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  for (let position = 0; position < bytes.length; position += JSON_WRITE_CHUNK_SIZE) {
    const chunk = bytes.slice(position, position + JSON_WRITE_CHUNK_SIZE);
    await writable.write({
      type: 'write',
      position,
      data: chunk,
    });
  }
  await writable.truncate(bytes.length);
}

export function createAppFsRepository(): AppFsRepository {
  async function ensureAppFileHandle(input: {
    baseDir: DirectoryHandleLike;
    filename: string;
    create: boolean;
    folderName?: string;
  }): Promise<FileHandleLike | null> {
    try {
      const appDir = await input.baseDir.getDirectoryHandle(input.folderName ?? '.fastcat', {
        create: input.create,
      });
      return await appDir.getFileHandle(input.filename, { create: input.create });
    } catch {
      return null;
    }
  }

  async function readJsonFromFileHandle<T>(handle: FileHandleLike): Promise<T | null> {
    const file = await withFileIoSlot(() => handle.getFile());
    const text = await withFileIoSlot(() => file.text());
    const trimmed = text.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed) as T;
  }

  async function writeJsonToFileHandle(input: {
    handle: FileHandleLike;
    data: unknown;
  }): Promise<void> {
    if (input.data === undefined) {
      throw new Error('Refusing to write undefined to JSON file');
    }
    await runResilientFileWrite(
      async () => {
        const writable = await input.handle.createWritable();
        try {
          await writeTextToWritableFileStream(writable, `${JSON.stringify(input.data, null, 2)}\n`);
        } finally {
          await (writable as FileSystemWritableFileStream & { close: () => Promise<void> })
            .close()
            .catch(() => undefined);
        }
      },
      { attempts: 6, baseDelayMs: 200 },
    );
  }

  return {
    ensureAppFileHandle,
    readJsonFromFileHandle,
    writeJsonToFileHandle,
  };
}

// Backward compatibility for standalone functions (if needed)
const defaultRepo = createAppFsRepository();
export const ensureAppFileHandle = defaultRepo.ensureAppFileHandle;
export const readJsonFromFileHandle = defaultRepo.readJsonFromFileHandle;
export const writeJsonToFileHandle = defaultRepo.writeJsonToFileHandle;
