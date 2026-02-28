export type FileHandleLike = Pick<FileSystemFileHandle, 'getFile' | 'createWritable'>;

export type DirectoryHandleLike = Pick<
  FileSystemDirectoryHandle,
  'getDirectoryHandle' | 'getFileHandle'
>;

export async function ensureGranFileHandle(input: {
  baseDir: DirectoryHandleLike;
  filename: string;
  create: boolean;
}): Promise<FileHandleLike | null> {
  try {
    const granDir = await input.baseDir.getDirectoryHandle('.gran', { create: input.create });
    return await granDir.getFileHandle(input.filename, { create: input.create });
  } catch {
    return null;
  }
}

export async function readJsonFromFileHandle<T>(handle: FileHandleLike): Promise<T | null> {
  const file = await handle.getFile();
  const text = await file.text();
  const trimmed = text.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as T;
}

export async function writeJsonToFileHandle(input: {
  handle: FileHandleLike;
  data: unknown;
}): Promise<void> {
  const writable = await input.handle.createWritable();
  await writable.write(`${JSON.stringify(input.data, null, 2)}\n`);
  await writable.close();
}
