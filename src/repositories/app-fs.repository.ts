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
    const file = await handle.getFile();
    const text = await file.text();
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
    const writable = await input.handle.createWritable();
    await writable.write(`${JSON.stringify(input.data, null, 2)}\n`);
    await writable.close();
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
