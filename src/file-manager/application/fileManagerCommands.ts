import { AUDIO_DIR_NAME, FILES_DIR_NAME, IMAGES_DIR_NAME, VIDEO_DIR_NAME } from '~/utils/constants';
import type { FsEntry } from '~/types/fs';
import {
  assertEntryDoesNotExist,
  copyDirectoryRecursive,
  copyFileToDirectory,
  renameDirectoryFallback,
} from '~/file-manager/fs/ops';

export interface HandleFilesDeps {
  getProjectDirHandle: () => Promise<FileSystemDirectoryHandle>;
  getTargetDirHandle: (params: {
    projectDir: FileSystemDirectoryHandle;
    file: File;
  }) => Promise<{ dir: FileSystemDirectoryHandle; relativePathBase: string } | null>;
  convertSvgToPng: (file: File) => Promise<File>;
  onSvgConvertError: (params: { file: File; error: unknown }) => void;
  onSkipProjectFile: (params: { file: File }) => void;
  onMediaImported: (params: {
    fileHandle: FileSystemFileHandle;
    projectRelativePath: string;
    file: File;
  }) => void;
}

export async function handleFilesCommand(
  files: FileList | File[],
  params: {
    targetDirHandle?: FileSystemDirectoryHandle;
    targetDirPath?: string;
  },
  deps: HandleFilesDeps,
): Promise<void> {
  const projectDir = await deps.getProjectDirHandle();
  const targetDirHandleRaw = params.targetDirHandle;

  for (let file of Array.from(files)) {
    if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
      try {
        file = await deps.convertSvgToPng(file);
      } catch (e) {
        deps.onSvgConvertError({ file, error: e });
        continue;
      }
    }

    let targetDir = targetDirHandleRaw;
    let finalRelativePathBase = params.targetDirPath || '';

    if (!targetDir) {
      const resolved = await deps.getTargetDirHandle({ projectDir, file });
      if (!resolved) {
        deps.onSkipProjectFile({ file });
        continue;
      }

      targetDir = resolved.dir;
      finalRelativePathBase = resolved.relativePathBase;
    }

    try {
      await targetDir.getFileHandle(file.name);
      throw new Error(`File already exists: ${file.name}`);
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') throw e;
    }

    const fileHandle = await targetDir.getFileHandle(file.name, { create: true });
    if (typeof (fileHandle as FileSystemFileHandle).createWritable !== 'function') {
      throw new Error('Failed to write file: createWritable is not available');
    }

    const writable = await (fileHandle as FileSystemFileHandle).createWritable();
    await writable.write(file);
    await writable.close();

    if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
      const projectRelativePath = finalRelativePathBase
        ? `${finalRelativePathBase}/${file.name}`
        : file.name;
      deps.onMediaImported({ fileHandle, projectRelativePath, file });
    }
  }
}

export async function resolveDefaultTargetDir(params: {
  projectDir: FileSystemDirectoryHandle;
  file: File;
}): Promise<{ dir: FileSystemDirectoryHandle; relativePathBase: string } | null> {
  if (params.file.name.endsWith('.otio')) return null;

  let targetDirName = FILES_DIR_NAME;
  if (params.file.type.startsWith('audio/')) targetDirName = AUDIO_DIR_NAME;
  else if (params.file.type.startsWith('image/')) targetDirName = IMAGES_DIR_NAME;
  else if (params.file.type.startsWith('video/')) targetDirName = VIDEO_DIR_NAME;

  const dir = await params.projectDir.getDirectoryHandle(targetDirName, { create: true });
  return { dir, relativePathBase: targetDirName };
}

export async function createFolderCommand(params: {
  name: string;
  baseDir: FileSystemDirectoryHandle;
}): Promise<void> {
  await params.baseDir.getDirectoryHandle(params.name, { create: true });
}

export interface DeleteEntryDeps {
  removeEntry: (params: {
    parentHandle: FileSystemDirectoryHandle;
    name: string;
    recursive: boolean;
  }) => Promise<void>;
  onFileDeleted?: (params: { path: string }) => Promise<void> | void;
}

export async function deleteEntryCommand(target: FsEntry, deps: DeleteEntryDeps): Promise<void> {
  if (!target.parentHandle) return;

  await deps.removeEntry({
    parentHandle: target.parentHandle as FileSystemDirectoryHandle,
    name: target.name,
    recursive: true,
  });

  if (target.kind === 'file' && typeof target.path === 'string' && target.path.length > 0) {
    await deps.onFileDeleted?.({ path: target.path });
  }
}

type FsFileHandleWithMove = FileSystemFileHandle & {
  move?: (name: string) => Promise<void>;
};

export interface RenameEntryDeps {
  ensureTargetNameDoesNotExist: (params: {
    parentHandle: FileSystemDirectoryHandle;
    kind: 'file' | 'directory';
    newName: string;
  }) => Promise<void>;
  removeEntry: (params: {
    parentHandle: FileSystemDirectoryHandle;
    name: string;
    recursive: boolean;
  }) => Promise<void>;
}

export async function renameEntryCommand(
  params: {
    target: FsEntry;
    newName: string;
  },
  deps: RenameEntryDeps,
): Promise<void> {
  const target = params.target;
  if (!target.parentHandle) return;

  const parent = target.parentHandle as FileSystemDirectoryHandle;
  await deps.ensureTargetNameDoesNotExist({
    parentHandle: parent,
    kind: target.kind,
    newName: params.newName,
  });

  if (target.kind === 'file') {
    const handle = target.handle as FsFileHandleWithMove;
    if (typeof handle.move === 'function') {
      await handle.move(params.newName);
      return;
    }

    const file = await (handle as FileSystemFileHandle).getFile();
    const newHandle = await parent.getFileHandle(params.newName, { create: true });
    if (typeof (newHandle as FileSystemFileHandle).createWritable !== 'function') {
      throw new Error('Failed to rename file: createWritable is not available');
    }

    const writable = await (newHandle as FileSystemFileHandle).createWritable();
    await writable.write(file);
    await writable.close();
    await deps.removeEntry({ parentHandle: parent, name: target.name, recursive: false });
    return;
  }

  const dirHandle = target.handle as unknown as { move?: (name: string) => Promise<void> };
  if (typeof dirHandle.move === 'function') {
    await dirHandle.move(params.newName);
    return;
  }

  await renameDirectoryFallback({
    sourceDirHandle: target.handle as FileSystemDirectoryHandle,
    sourceName: target.name,
    parentDirHandle: parent,
    newName: params.newName,
  });
}

export interface MoveEntryDeps {
  removeEntry: (params: {
    parentHandle: FileSystemDirectoryHandle;
    name: string;
    recursive: boolean;
  }) => Promise<void>;
  onFileMoved?: (params: { oldPath: string; newPath: string }) => Promise<void> | void;
  onDirectoryMoved?: () => Promise<void> | void;
}

export async function moveEntryCommand(
  params: {
    source: FsEntry;
    targetDirHandle: FileSystemDirectoryHandle;
    targetDirPath: string;
  },
  deps: MoveEntryDeps,
): Promise<void> {
  if (!params.source.parentHandle) return;

  const sourcePath = params.source.path ?? '';
  const targetDirPath = params.targetDirPath ?? '';
  if (!sourcePath) return;

  const targetDirHandle = params.targetDirHandle;
  const sourceParentHandle = params.source.parentHandle as FileSystemDirectoryHandle;

  await assertEntryDoesNotExist({
    targetDirHandle,
    entryName: params.source.name,
    kind: params.source.kind,
  });

  if (params.source.kind === 'file') {
    await copyFileToDirectory({
      sourceHandle: params.source.handle as FileSystemFileHandle,
      fileName: params.source.name,
      targetDirHandle,
    });
    await deps.removeEntry({
      parentHandle: sourceParentHandle,
      name: params.source.name,
      recursive: false,
    });

    const oldPath = sourcePath;
    const newPath = targetDirPath ? `${targetDirPath}/${params.source.name}` : params.source.name;
    await deps.onFileMoved?.({ oldPath, newPath });
    return;
  }

  const targetDir = await targetDirHandle.getDirectoryHandle(params.source.name, { create: true });
  await copyDirectoryRecursive({
    sourceDirHandle: params.source.handle as FileSystemDirectoryHandle,
    targetDirHandle: targetDir,
  });
  await deps.removeEntry({
    parentHandle: sourceParentHandle,
    name: params.source.name,
    recursive: true,
  });
  await deps.onDirectoryMoved?.();
}

export async function createTimelineCommand(params: {
  projectDir: FileSystemDirectoryHandle;
  timelinesDirName: string;
  initialIndex?: number;
}): Promise<string> {
  const timelinesDir = await params.projectDir.getDirectoryHandle(params.timelinesDirName, {
    create: true,
  });

  let index = params.initialIndex ?? 1;
  let fileName = '';
  let exists = true;
  while (exists) {
    fileName = `timeline_${String(index).padStart(3, '0')}.otio`;
    try {
      await timelinesDir.getFileHandle(fileName);
      index += 1;
    } catch (e: any) {
      if (e?.name === 'NotFoundError') {
        exists = false;
        continue;
      }
      throw e;
    }
  }

  const fileHandle = await timelinesDir.getFileHandle(fileName, { create: true });
  if (typeof (fileHandle as FileSystemFileHandle).createWritable !== 'function') {
    throw new Error('Failed to create timeline: createWritable is not available');
  }

  const writable = await (fileHandle as FileSystemFileHandle).createWritable();
  const payload = {
    OTIO_SCHEMA: 'Timeline.1',
    name: fileName.replace('.otio', ''),
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      children: [],
      name: 'tracks',
    },
  };
  await writable.write(JSON.stringify(payload, null, 2));
  await writable.close();

  return `${params.timelinesDirName}/${fileName}`;
}
