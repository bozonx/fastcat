import type { IFileSystemAdapter } from './types';
import { MAX_COPY_DEPTH } from '~/file-manager/core/rules';

export interface CrossVfsCopyOptions {
  sourceVfs: IFileSystemAdapter;
  targetVfs: IFileSystemAdapter;
  sourcePath: string;
  sourceKind: 'file' | 'directory';
  targetDirPath: string;
  signal?: AbortSignal;
}

function sanitizeLocalEntryName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim();

  return sanitized || 'untitled';
}

function normalizeTargetEntryName(name: string, targetVfs: IFileSystemAdapter): string {
  if (targetVfs.id === 'bloggerdog') {
    return name;
  }

  return sanitizeLocalEntryName(name);
}

async function generateUniqueName(
  name: string,
  targetVfs: IFileSystemAdapter,
  targetDirPath: string,
): Promise<string> {
  const normalizedName = normalizeTargetEntryName(name, targetVfs);
  const existingNames = await targetVfs.listEntryNames(targetDirPath || '');
  if (!existingNames.includes(normalizedName)) return normalizedName;

  const lastDotIndex = normalizedName.lastIndexOf('.');
  const baseName = lastDotIndex > 0 ? normalizedName.slice(0, lastDotIndex) : normalizedName;
  const extension = lastDotIndex > 0 ? normalizedName.slice(lastDotIndex) : '';

  let counter = 1;
  while (true) {
    const candidateName = `${baseName} (${counter})${extension}`;
    if (!existingNames.includes(candidateName)) return candidateName;
    counter++;
  }
}

async function copyDirectoryRecursive(
  sourceVfs: IFileSystemAdapter,
  targetVfs: IFileSystemAdapter,
  sourcePath: string,
  targetPath: string,
  depth: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  if (depth > MAX_COPY_DEPTH) {
    throw new Error(`Maximum copy depth exceeded (${MAX_COPY_DEPTH})`);
  }

  await targetVfs.createDirectory(targetPath);
  const entries = await sourceVfs.readDirectory(sourcePath);

  for (const entry of entries) {
    const nextTargetName = await generateUniqueName(entry.name, targetVfs, targetPath);
    const nextTargetPath = `${targetPath}/${nextTargetName}`;
    if (entry.kind === 'directory') {
      await copyDirectoryRecursive(
        sourceVfs,
        targetVfs,
        entry.path,
        nextTargetPath,
        depth + 1,
        signal,
      );
    } else {
      const readStream = await sourceVfs.readStream(entry.path);
      const writeStream = await targetVfs.writeStream(nextTargetPath);
      await readStream.pipeTo(writeStream, { signal });
    }
  }
}

export async function crossVfsCopy(options: CrossVfsCopyOptions): Promise<string> {
  const { sourceVfs, targetVfs, sourcePath, sourceKind, targetDirPath } = options;

  const sourceName = sourcePath.split('/').pop() || sourcePath;
  const targetName = await generateUniqueName(sourceName, targetVfs, targetDirPath);
  const targetPath = targetDirPath ? `${targetDirPath}/${targetName}` : targetName;

  if (sourceKind === 'file') {
    if (options.signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    const readStream = await sourceVfs.readStream(sourcePath);
    const writeStream = await targetVfs.writeStream(targetPath);
    await readStream.pipeTo(writeStream, { signal: options.signal });
    return targetPath;
  }

  await copyDirectoryRecursive(sourceVfs, targetVfs, sourcePath, targetPath, 0, options.signal);
  return targetPath;
}

export async function crossVfsMove(options: CrossVfsCopyOptions): Promise<string> {
  const targetPath = await crossVfsCopy(options);
  await options.sourceVfs.deleteEntry(options.sourcePath, true);
  return targetPath;
}
