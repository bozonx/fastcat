import { AUDIO_DIR_NAME, FILES_DIR_NAME, IMAGES_DIR_NAME, VIDEO_DIR_NAME } from '~/utils/constants';

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
      const projectRelativePath = finalRelativePathBase ? `${finalRelativePathBase}/${file.name}` : file.name;
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
