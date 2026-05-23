import { runResilientFileWrite } from '~/utils/io/io-governor';

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
