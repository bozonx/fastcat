import {
  AUDIO_DIR_NAME,
  DOCUMENTS_DIR_NAME,
  FILES_DIR_NAME,
  IMAGES_DIR_NAME,
  VIDEO_DIR_NAME,
} from '~/utils/constants';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import PQueue from 'p-queue';
import { generateUniqueFsEntryName } from '~/utils/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { createDefaultTimelineDocument, serializeTimelineToOtio } from '~/timeline/otio-serializer';
import type { TimelineFormatInput } from '~/timeline/format';

export const LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES = 100 * 1024 * 1024;

function splitFileName(name: string): { baseName: string; extension: string } {
  const lastDotIndex = name.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === name.length - 1) {
    return {
      baseName: name,
      extension: '',
    };
  }

  return {
    baseName: name.slice(0, lastDotIndex),
    extension: name.slice(lastDotIndex),
  };
}

async function generateUniqueEntryNameWithSuffix(params: {
  vfs: IFileSystemAdapter;
  dirPath: string;
  name: string;
}): Promise<string> {
  const { baseName, extension } = splitFileName(params.name);
  let candidateName = params.name;
  let candidatePath = params.dirPath ? `${params.dirPath}/${candidateName}` : candidateName;

  if (!(await params.vfs.exists(candidatePath))) {
    return candidateName;
  }

  let counter = 1;
  while (counter < 10000) {
    candidateName = `${baseName} (${counter})${extension}`;
    candidatePath = params.dirPath ? `${params.dirPath}/${candidateName}` : candidateName;
    if (!(await params.vfs.exists(candidatePath))) {
      return candidateName;
    }
    counter++;
  }
  throw new Error('Unable to generate unique entry name: too many conflicts');
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

  const writable = await params.vfs.writeStream(params.targetPath);
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
  const queue = new PQueue({ concurrency: 3 });
  const allFiles = Array.from(files);
  const totalFiles = allFiles.length;
  const totalBytes = allFiles.reduce((acc, file) => acc + file.size, 0);
  const fileLoadedBytes = new Map<number, number>();
  let completedCount = 0;

  function reportProgress(params: {
    fileIndex: number;
    file: File;
    currentFileBytes?: number;
  }) {
    if (params.currentFileBytes !== undefined) {
      fileLoadedBytes.set(params.fileIndex, params.currentFileBytes);
    }

    const loadedBytes = Array.from(fileLoadedBytes.values()).reduce((acc, value) => acc + value, 0);
    deps.onProgress?.({
      currentFileIndex: completedCount,
      totalFiles,
      fileName: params.file.name,
      currentFileBytes: params.currentFileBytes,
      totalFileBytes: params.file.size,
      loadedBytes,
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

      const targetPath = finalRelativePathBase
        ? `${finalRelativePathBase}/${file.name}`
        : file.name;

      if (await deps.vfs.exists(targetPath)) {
        // Instead of throwing, we can skip or generate unique name.
        // For timeline drop, standard behavior in many editors is to auto-rename if it's a conflict
        // but here we just throw as before, or handle conflict.
        // Let's stick to existing behavior for now but maybe better to auto-generate name.
        const uniqueName = await generateUniqueEntryNameWithSuffix({
          vfs: deps.vfs,
          dirPath: finalRelativePathBase,
          name: file.name,
        });
        const uniquePath = finalRelativePathBase
          ? `${finalRelativePathBase}/${uniqueName}`
          : uniqueName;

        await writeImportedFile({
          vfs: deps.vfs,
          targetPath: uniquePath,
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
          deps.onMediaImported({ projectRelativePath: uniquePath, file });
        }

        return {
          fileName: uniqueName,
          targetPath: uniquePath,
          targetDir: finalRelativePathBase,
        };
      }

      await writeImportedFile({
        vfs: deps.vfs,
        targetPath,
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
        deps.onMediaImported({ projectRelativePath: targetPath, file });
      }

      return {
        fileName: file.name,
        targetPath,
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
  const nextPath = params.parentPath ? `${params.parentPath}/${params.name}` : params.name;
  await params.vfs.createDirectory(nextPath);
}

export interface DeleteEntryDeps {
  vfs: IFileSystemAdapter;
  onFileDeleted?: (params: { path: string }) => Promise<void> | void;
}

export async function deleteEntryCommand(target: FsEntry, deps: DeleteEntryDeps): Promise<void> {
  await deps.vfs.deleteEntry(target.path, true);

  if (target.kind === 'file' && target.path.length > 0) {
    await deps.onFileDeleted?.({ path: target.path });
  }
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
  const target = params.target;
  const parentPath = target.parentPath ?? target.path.split('/').slice(0, -1).join('/');
  const nextPath = parentPath ? `${parentPath}/${params.newName}` : params.newName;

  if (await deps.vfs.exists(nextPath)) {
    throw new Error(`Target name already exists: ${params.newName}`);
  }

  await deps.vfs.moveEntry(target.path, nextPath);
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
  const newName = await generateUniqueEntryNameWithSuffix({
    vfs: deps.vfs,
    dirPath: targetDirPath,
    name: params.source.name,
  });
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
  if (params.abortSignal?.aborted) throw new Error('Aborted');

  const sourcePath = params.source.path;
  const targetDirPath = params.targetDirPath ?? '';
  if (!sourcePath) {
    throw new Error('Source path is required');
  }

  const nextName = await generateUniqueEntryNameWithSuffix({
    vfs: deps.vfs,
    dirPath: targetDirPath,
    name: params.source.name,
  });
  const newPath = targetDirPath ? `${targetDirPath}/${nextName}` : nextName;

  if (params.source.kind === 'file') {
    await deps.vfs.copyFile(sourcePath, newPath);
    await deps.onFileCopied?.({ sourcePath, newPath });
    return { newPath };
  }

  await deps.vfs.copyDirectory(sourcePath, newPath);
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

  const fullPath = `${basePath}/${fileName}`;
  await params.vfs.writeFile(fullPath, '');

  return fullPath;
}
