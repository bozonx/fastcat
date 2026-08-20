import { isTransientWriteError } from '~/utils/io/io-governor';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { VfsNotFoundError } from '~/file-manager/core/vfs/errors';

/**
 * Structural handle types still used by the workspace provider and storage
 * helpers. The platform handle (OPFS handle / Tauri shim) is the ground truth
 * the VFS adapters are built on; these aliases keep those call sites typed.
 */
export type FileHandleLike = Pick<FileSystemFileHandle, 'getFile' | 'createWritable'>;

export type DirectoryHandleLike = Pick<
  FileSystemDirectoryHandle,
  'getDirectoryHandle' | 'getFileHandle' | 'removeEntry'
> & {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
};

/**
 * VFS-native JSON store. Paths are routed through the application VFS adapter
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
        // The adapter already acquires an I/O slot inside readFile, so we
        // must not wrap it again — nesting withFileIoSlot deadlocks the
        // small interactive budget (pool=2) when multiple reads run
        // concurrently during workspace init.
        blob = await vfs.readFile(path);
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
