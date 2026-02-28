export interface FileHandleLike {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

export interface DirectoryHandleLike {
  getDirectoryHandle(
    name: string,
    options?: {
      create?: boolean;
    },
  ): Promise<DirectoryHandleLike>;
  getFileHandle(
    name: string,
    options?: {
      create?: boolean;
    },
  ): Promise<FileHandleLike>;
}

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

export async function readJsonFromFileHandle<T>(
  handle: FileHandleLike,
): Promise<T | null> {
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
