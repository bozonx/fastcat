import {
  AUDIO_DIR_NAME,
  DOCUMENTS_DIR_NAME,
  FILES_DIR_NAME,
  IMAGES_DIR_NAME,
  VIDEO_DIR_NAME,
} from '~/utils/constants';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import {
  assertValidFsEntryName,
  isCopyAllowed,
  isMoveAllowed,
  MAX_TREE_TRAVERSAL_DEPTH,
} from '~/file-manager/core/rules';
import PQueue from 'p-queue';
import { generateUniqueFsEntryName } from '~/utils/fs';
import { getNextIncrementName } from '~/utils/filename-increment';
import { VfsConflictError } from '~/file-manager/core/vfs/errors';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { createDevLogger } from '~/utils/dev-logger';
import { createDefaultTimelineDocument, serializeTimelineToOtio } from '~/timeline/otio-serializer';
import type { TimelineFormatInput } from '~/timeline/format';

export const LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES = 100 * 1024 * 1024;

async function generateUniqueEntryNameWithSuffix(params: {
  vfs: IFileSystemAdapter;
  dirPath: string;
  name: string;
}): Promise<string> {
  const existingNames =
    typeof params.vfs.listEntryNames === 'function'
      ? await params.vfs.listEntryNames(params.dirPath)
      : [];
  const proposedName = getNextIncrementName({
    fileName: params.name,
    existingNames,
    style: 'parentheses',
    padWidth: 1,
    startIndex: 1,
    forceIndex: false,
  });

  // Verify against the filesystem as a safety net in case existingNames was stale.
  let verifyPath = params.dirPath ? `${params.dirPath}/${proposedName}` : proposedName;
  let attempts = 0;
  const currentNames = [...existingNames];
  let currentProposed = proposedName;
  while (await params.vfs.exists(verifyPath)) {
    attempts++;
    if (attempts > 1000) {
      throw new Error('Unable to generate unique entry name: too many conflicts');
    }
    currentNames.push(currentProposed);
    currentProposed = getNextIncrementName({
      fileName: params.name,
      existingNames: currentNames,
      style: 'parentheses',
      padWidth: 1,
      startIndex: 1,
      forceIndex: false,
    });
    verifyPath = params.dirPath ? `${params.dirPath}/${currentProposed}` : currentProposed;
  }

  return currentProposed;
}

export interface UploadResult {
  fileName: string;
  targetPath: string;
  targetDir: string;
}

export interface HandleFilesDeps {
  vfs: IFileSystemAdapter;
  getTargetDirPath: (params: { file: File }) => Promise<string | null>;
  onSkipProjectFile: (params: { file: File }) => void;
  onMediaImported: (params: { projectRelativePath: string; file: File }) => void;
  onProgress?: (params: {
    currentFileIndex: number;
    totalFiles: number;
    fileName: string;
    currentFileBytes?: number;
    totalFileBytes?: number;
    loadedBytes?: number;
    totalBytes?: number;
  }) => void;
}

async function writeImportedFile(params: {
  vfs: IFileSystemAdapter;
  targetPath: string;
  file: File;
  abortSignal?: AbortSignal;
  onChunk?: (bytes: number) => void;
}): Promise<void> {
  if (params.abortSignal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  const writable = await params.vfs.writeStream(params.targetPath, { signal: params.abortSignal });
  let currentFileBytes = 0;
  const progressStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      currentFileBytes += chunk.byteLength;
      params.onChunk?.(currentFileBytes);
      controller.enqueue(chunk);
    },
  });

  await params.file
    .stream()
    .pipeThrough(progressStream, { signal: params.abortSignal })
    .pipeTo(writable, { signal: params.abortSignal });
}

export async function handleFilesCommand(
  files: FileList | File[],
  params: {
    targetDirPath?: string;
    abortSignal?: AbortSignal;
  },
  deps: HandleFilesDeps,
): Promise<UploadResult[]> {
  const queue = new PQueue({ concurrency: 2 });
  const allFiles = Array.from(files);
  const totalFiles = allFiles.length;
  const totalBytes = allFiles.reduce((acc, file) => acc + file.size, 0);
  const fileLoadedBytes = new Map<number, number>();
  let loadedBytes = 0;
  let completedCount = 0;

  function reportProgress(params: { fileIndex: number; file: File; currentFileBytes?: number }) {
    if (params.currentFileBytes !== undefined) {
      const previousBytes = fileLoadedBytes.get(params.fileIndex) ?? 0;
      fileLoadedBytes.set(params.fileIndex, params.currentFileBytes);
      loadedBytes += Math.max(0, params.currentFileBytes - previousBytes);
    }

    deps.onProgress?.({
      currentFileIndex: completedCount,
      totalFiles,
      fileName: params.file.name,
      currentFileBytes: params.currentFileBytes,
      totalFileBytes: params.file.size,
      loadedBytes: Math.min(loadedBytes, totalBytes),
      totalBytes,
    });
  }

  const tasks = allFiles.map((inputFile, index) =>
    queue.add(async () => {
      if (params.abortSignal?.aborted) return;

      const file = inputFile;

      let finalRelativePathBase: string;

      if (params.targetDirPath === undefined) {
        const resolved = await deps.getTargetDirPath({ file });
        if (!resolved) {
          deps.onSkipProjectFile({ file });
          return;
        }

        finalRelativePathBase = resolved;
      } else {
        finalRelativePathBase = params.targetDirPath;
      }

      // Always go through the unique-name resolver: it short-circuits when
      // the original name is free, and otherwise picks a non-conflicting
      // suffix. This avoids a TOCTOU between an exists()-check and the write.
      const finalName = await generateUniqueEntryNameWithSuffix({
        vfs: deps.vfs,
        dirPath: finalRelativePathBase,
        name: file.name,
      });
      const finalPath = finalRelativePathBase ? `${finalRelativePathBase}/${finalName}` : finalName;

      await writeImportedFile({
        vfs: deps.vfs,
        targetPath: finalPath,
        file,
        abortSignal: params.abortSignal,
        onChunk: (currentFileBytes) => {
          reportProgress({ fileIndex: index, file, currentFileBytes });
        },
      });

      fileLoadedBytes.set(index, file.size);
      completedCount++;
      reportProgress({ fileIndex: index, file, currentFileBytes: file.size });

      const mediaType = getMediaTypeFromFilename(file.name);
      if (mediaType === 'video' || mediaType === 'audio' || mediaType === 'image') {
        deps.onMediaImported({ projectRelativePath: finalPath, file });
      }

      return {
        fileName: finalName,
        targetPath: finalPath,
        targetDir: finalRelativePathBase,
      };
    }),
  );

  const results = await Promise.all(tasks);
  return results.filter((r): r is UploadResult => r !== undefined);
}

export async function resolveDefaultTargetDir(
  params: { file: File } | { name: string },
): Promise<string | null> {
  let fileName: string;
  if ('file' in params) {
    fileName = params.file.name;
  } else {
    fileName = params.name;
  }
  const mediaType = getMediaTypeFromFilename(fileName);

  if (mediaType === 'timeline') return null;

  switch (mediaType) {
    case 'audio':
      return AUDIO_DIR_NAME;
    case 'image':
      return IMAGES_DIR_NAME;
    case 'video':
      return VIDEO_DIR_NAME;
    case 'text': {
      const name = 'file' in params ? params.file.name : params.name;
      const ext = name.split('.').pop()?.toLowerCase();
      if (ext === 'md' || ext === 'txt') return DOCUMENTS_DIR_NAME;
      return FILES_DIR_NAME;
    }
    default:
      return FILES_DIR_NAME;
  }
}

export async function createFolderCommand(params: {
  name: string;
  parentPath?: string;
  vfs: IFileSystemAdapter;
}): Promise<void> {
  assertValidFsEntryName(params.name);
  const nextPath = params.parentPath ? `${params.parentPath}/${params.name}` : params.name;
  await params.vfs.createDirectory(nextPath);
}

export interface DeleteEntryDeps {
  vfs: IFileSystemAdapter;
  onFileDeleted?: (params: { path: string }) => Promise<void> | void;
}

const deleteLogger = createDevLogger('fileManagerCommands:delete');

async function collectDeletedFilePaths(params: {
  vfs: IFileSystemAdapter;
  entry: FsEntry;
  depth?: number;
}): Promise<string[]> {
  const depth = params.depth ?? 0;
  if (params.entry.kind === 'file') return params.entry.path ? [params.entry.path] : [];
  if (!params.entry.path) return [];
  if (depth > MAX_TREE_TRAVERSAL_DEPTH) {
    throw new Error(`Maximum delete cleanup depth exceeded (${MAX_TREE_TRAVERSAL_DEPTH})`);
  }

  let entries: Awaited<ReturnType<IFileSystemAdapter['readDirectory']>> = [];
  try {
    entries = await params.vfs.readDirectory(params.entry.path);
  } catch (err) {
    deleteLogger.warn('Failed to read directory during delete cleanup:', params.entry.path, err);
    return [];
  }

  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.kind === 'file') {
      paths.push(entry.path);
      continue;
    }
    try {
      paths.push(
        ...(await collectDeletedFilePaths({
          vfs: params.vfs,
          entry: entry as FsEntry,
          depth: depth + 1,
        })),
      );
    } catch (err) {
      deleteLogger.warn('Failed to traverse subtree during delete cleanup:', entry.path, err);
    }
  }
  return paths;
}

export async function deleteEntryCommand(
  target: FsEntry,
  deps: DeleteEntryDeps,
): Promise<string[]> {
  const deletedFilePaths = await collectDeletedFilePaths({ vfs: deps.vfs, entry: target });

  await deps.vfs.deleteEntry(target.path, true);

  for (const path of deletedFilePaths) {
    await deps.onFileDeleted?.({ path });
  }

  return deletedFilePaths;
}

export interface RenameEntryDeps {
  vfs: IFileSystemAdapter;
}

export async function renameEntryCommand(
  params: {
    target: FsEntry;
    newName: string;
  },
  deps: RenameEntryDeps,
): Promise<void> {
  assertValidFsEntryName(params.newName);
  const target = params.target;
  const parentPath = target.parentPath ?? target.path.split('/').slice(0, -1).join('/');
  const nextPath = parentPath ? `${parentPath}/${params.newName}` : params.newName;

  try {
    await deps.vfs.moveEntry(target.path, nextPath);
  } catch (e) {
    if (e instanceof VfsConflictError) {
      throw new Error(`Target name already exists: ${params.newName}`);
    }
    throw e;
  }
}

export interface MoveEntryDeps {
  vfs: IFileSystemAdapter;
  onFileMoved?: (params: { oldPath: string; newPath: string }) => Promise<void> | void;
  onDirectoryMoved?: (params: { oldPath: string; newPath: string }) => Promise<void> | void;
}

export async function moveEntryCommand(
  params: {
    source: FsEntry;
    targetDirPath: string;
  },
  deps: MoveEntryDeps,
): Promise<{ newPath: string }> {
  const sourcePath = params.source.path;
  const targetDirPath = params.targetDirPath ?? '';
  if (!sourcePath) {
    throw new Error('Source path is required');
  }
  if (!isMoveAllowed({ sourcePath, targetDirPath })) {
    throw new Error(`Cannot move "${sourcePath}" into itself or its descendant`);
  }
  assertValidFsEntryName(params.source.name);

  const sourceParentPath = params.source.parentPath ?? sourcePath.split('/').slice(0, -1).join('/');
  if (sourceParentPath === targetDirPath) {
    return { newPath: sourcePath };
  }

  const newName = await generateUniqueEntryNameWithSuffix({
    vfs: deps.vfs,
    dirPath: targetDirPath,
    name: params.source.name,
  });
  assertValidFsEntryName(newName);
  const newPath = targetDirPath ? `${targetDirPath}/${newName}` : newName;

  await deps.vfs.moveEntry(sourcePath, newPath);

  if (params.source.kind === 'file') {
    await deps.onFileMoved?.({ oldPath: sourcePath, newPath });
    return { newPath };
  }

  await deps.onDirectoryMoved?.({ oldPath: sourcePath, newPath });
  return { newPath };
}

export interface CopyEntryDeps {
  vfs: IFileSystemAdapter;
  onFileCopied?: (params: { sourcePath: string; newPath: string }) => Promise<void> | void;
  onDirectoryCopied?: (params: { oldPath: string; newPath: string }) => Promise<void> | void;
}

export async function copyEntryCommand(
  params: {
    source: FsEntry;
    targetDirPath: string;
    abortSignal?: AbortSignal;
  },
  deps: CopyEntryDeps,
): Promise<{ newPath: string }> {
  if (params.abortSignal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  const sourcePath = params.source.path;
  const targetDirPath = params.targetDirPath ?? '';
  if (!sourcePath) {
    throw new Error('Source path is required');
  }
  if (!isCopyAllowed({ sourcePath, targetDirPath })) {
    throw new Error(`Cannot copy "${sourcePath}" into itself or its descendant`);
  }
  assertValidFsEntryName(params.source.name);

  const nextName = await generateUniqueEntryNameWithSuffix({
    vfs: deps.vfs,
    dirPath: targetDirPath,
    name: params.source.name,
  });
  assertValidFsEntryName(nextName);
  const newPath = targetDirPath ? `${targetDirPath}/${nextName}` : nextName;

  if (params.source.kind === 'file') {
    await deps.vfs.copyFile(sourcePath, newPath, { signal: params.abortSignal });
    await deps.onFileCopied?.({ sourcePath, newPath });
    return { newPath };
  }

  await deps.vfs.copyDirectory(sourcePath, newPath, { signal: params.abortSignal });
  await deps.onDirectoryCopied?.({ oldPath: sourcePath, newPath });
  return { newPath };
}

export async function createTimelineCommand(params: {
  vfs: IFileSystemAdapter;
  timelinesDirName?: string;
  initialIndex?: number;
  existingNames?: string[];
  format: TimelineFormatInput;
}): Promise<string> {
  const basePath = params.timelinesDirName ?? '';
  if (basePath) {
    await params.vfs.createDirectory(basePath);
  }

  const fileName = await generateUniqueFsEntryName({
    vfs: params.vfs,
    dirPath: basePath,
    baseName: 'timeline_',
    extension: '.otio',
    existingNames: params.existingNames,
    startIndex: params.initialIndex,
  });
  const timelineName = fileName.replace('.otio', '');
  const payload = createDefaultTimelineDocument({
    id: timelineName,
    name: timelineName,
    format: params.format,
  });

  const fullPath = basePath ? `${basePath}/${fileName}` : fileName;
  await params.vfs.writeJson(fullPath, JSON.parse(serializeTimelineToOtio(payload)));

  return fullPath;
}

export async function createMarkdownCommand(params: {
  vfs: IFileSystemAdapter;
  dirPath: string;
  existingNames?: string[];
}): Promise<string> {
  const basePath = params.dirPath;
  if (basePath) {
    await params.vfs.createDirectory(basePath);
  }

  const fileName = await generateUniqueFsEntryName({
    vfs: params.vfs,
    dirPath: basePath,
    baseName: 'document ',
    extension: '.md',
    existingNames: params.existingNames,
    padWidth: 2,
  });

  const fullPath = basePath ? `${basePath}/${fileName}` : fileName;
  await params.vfs.writeFile(fullPath, '');

  return fullPath;
}
