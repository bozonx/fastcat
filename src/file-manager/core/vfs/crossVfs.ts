import type { IFileSystemAdapter } from './types';

export interface CrossVfsCopyOptions {
  sourceVfs: IFileSystemAdapter;
  targetVfs: IFileSystemAdapter;
  sourcePath: string;
  sourceKind: 'file' | 'directory';
  targetDirPath: string;
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
): Promise<void> {
  if (depth > 10) throw new Error('Maximum copy depth exceeded');

  await targetVfs.createDirectory(targetPath);
  const entries = await sourceVfs.readDirectory(sourcePath);

  for (const entry of entries) {
    const nextTargetName = await generateUniqueName(entry.name, targetVfs, targetPath);
    const nextTargetPath = `${targetPath}/${nextTargetName}`;
    if (entry.kind === 'directory') {
      await copyDirectoryRecursive(sourceVfs, targetVfs, entry.path, nextTargetPath, depth + 1);
    } else {
      const data = await sourceVfs.readFile(entry.path);
      await targetVfs.writeFile(nextTargetPath, data);
    }
  }
}

export async function crossVfsCopy(options: CrossVfsCopyOptions): Promise<string> {
  const { sourceVfs, targetVfs, sourcePath, sourceKind, targetDirPath } = options;

  const sourceName = sourcePath.split('/').pop() || sourcePath;
  const targetName = await generateUniqueName(sourceName, targetVfs, targetDirPath);
  const targetPath = targetDirPath ? `${targetDirPath}/${targetName}` : targetName;

  if (sourceKind === 'file') {
    const data = await sourceVfs.readFile(sourcePath);
    await targetVfs.writeFile(targetPath, data);
    return targetPath;
  }

  await copyDirectoryRecursive(sourceVfs, targetVfs, sourcePath, targetPath, 0);
  return targetPath;
}

export async function crossVfsMove(options: CrossVfsCopyOptions): Promise<string> {
  const targetPath = await crossVfsCopy(options);
  await options.sourceVfs.deleteEntry(options.sourcePath, true);
  return targetPath;
}
