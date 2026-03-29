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
  while (true) {
    candidateName = `${baseName} (${counter})${extension}`;
    candidatePath = params.dirPath ? `${params.dirPath}/${candidateName}` : candidateName;
    if (!(await params.vfs.exists(candidatePath))) {
      return candidateName;
    }
    counter++;
  }
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
}

export async function handleFilesCommand(
  files: FileList | File[],
  params: {
    targetDirPath?: string;
  },
  deps: HandleFilesDeps,
): Promise<UploadResult[]> {
  const queue = new PQueue({ concurrency: 3 });

  const tasks = Array.from(files).map((inputFile) =>
    queue.add(async () => {
      const file = inputFile;

      let finalRelativePathBase = params.targetDirPath || '';

      if (!finalRelativePathBase) {
        const resolved = await deps.getTargetDirPath({ file });
        if (!resolved) {
          deps.onSkipProjectFile({ file });
          return;
        }

        finalRelativePathBase = resolved;
      }

      const targetPath = finalRelativePathBase
        ? `${finalRelativePathBase}/${file.name}`
        : file.name;

      if (await deps.vfs.exists(targetPath)) {
        throw new Error(`File already exists: ${file.name}`);
      }

      await deps.vfs.writeFile(targetPath, file);

      const mediaType = getMediaTypeFromFilename(file.name);
      if (mediaType === 'video' || mediaType === 'audio') {
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

export async function resolveDefaultTargetDir(params: { file: File }): Promise<string | null> {
  const mediaType = getMediaTypeFromFilename(params.file.name);

  if (mediaType === 'timeline') return null;

  switch (mediaType) {
    case 'audio':
      return AUDIO_DIR_NAME;
    case 'image':
      return IMAGES_DIR_NAME;
    case 'video':
      return VIDEO_DIR_NAME;
    case 'text': {
      const ext = params.file.name.split('.').pop()?.toLowerCase();
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
): Promise<void> {
  const sourcePath = params.source.path;
  const targetDirPath = params.targetDirPath ?? '';
  if (!sourcePath) return;
  const newName = await generateUniqueEntryNameWithSuffix({
    vfs: deps.vfs,
    dirPath: targetDirPath,
    name: params.source.name,
  });
  const newPath = targetDirPath ? `${targetDirPath}/${newName}` : newName;

  await deps.vfs.moveEntry(sourcePath, newPath);

  if (params.source.kind === 'file') {
    await deps.onFileMoved?.({ oldPath: sourcePath, newPath });
    return;
  }

  await deps.onDirectoryMoved?.({ oldPath: sourcePath, newPath });
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
  },
  deps: CopyEntryDeps,
): Promise<{ newPath: string }> {
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
  const payload = {
    OTIO_SCHEMA: 'Timeline.1',
    name: fileName.replace('.otio', ''),
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      children: [],
      name: 'tracks',
    },
  };

  const fullPath = basePath ? `${basePath}/${fileName}` : fileName;
  await params.vfs.writeJson(fullPath, payload);

  return fullPath;
}

export async function createMarkdownCommand(params: {
  vfs: IFileSystemAdapter;
  documentsDirName: string;
  existingNames?: string[];
}): Promise<string> {
  const basePath = params.documentsDirName;
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
