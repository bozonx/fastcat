interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

function getDirectoryIterator(
  handle: FileSystemDirectoryHandle,
): AsyncIterable<FileSystemHandle> | AsyncIterable<[string, FileSystemHandle]> | null {
  return (
    (handle as FsDirectoryHandleWithIteration).values?.() ??
    (handle as FsDirectoryHandleWithIteration).entries?.() ??
    null
  );
}

export async function assertEntryDoesNotExist(params: {
  targetDirHandle: FileSystemDirectoryHandle;
  entryName: string;
  kind: 'file' | 'directory';
}) {
  try {
    if (params.kind === 'file') {
      await params.targetDirHandle.getFileHandle(params.entryName);
    } else {
      await params.targetDirHandle.getDirectoryHandle(params.entryName);
    }
    throw new Error(`Target already exists: ${params.entryName}`);
  } catch (e: any) {
    if (e?.name !== 'NotFoundError') throw e;
  }
}

export async function copyFileToDirectory(params: {
  sourceHandle: FileSystemFileHandle;
  fileName: string;
  targetDirHandle: FileSystemDirectoryHandle;
}) {
  const file = await params.sourceHandle.getFile();
  const targetHandle = await params.targetDirHandle.getFileHandle(params.fileName, {
    create: true,
  });

  const createWritable = (targetHandle as FileSystemFileHandle).createWritable;
  if (typeof createWritable !== 'function') {
    throw new Error('Failed to move file: createWritable is not available');
  }

  const writable = await (targetHandle as FileSystemFileHandle).createWritable();
  await writable.write(file);
  await writable.close();
}

export async function copyDirectoryRecursive(params: {
  sourceDirHandle: FileSystemDirectoryHandle;
  targetDirHandle: FileSystemDirectoryHandle;
}): Promise<void> {
  const iterator = getDirectoryIterator(params.sourceDirHandle);
  if (!iterator) return;

  for await (const value of iterator) {
    const handle = (Array.isArray(value) ? value[1] : value) as
      | FileSystemFileHandle
      | FileSystemDirectoryHandle;

    if (handle.kind === 'file') {
      await copyFileToDirectory({
        sourceHandle: handle as FileSystemFileHandle,
        fileName: handle.name,
        targetDirHandle: params.targetDirHandle,
      });
      continue;
    }

    const nextTargetDir = await params.targetDirHandle.getDirectoryHandle(handle.name, {
      create: true,
    });
    await copyDirectoryRecursive({
      sourceDirHandle: handle as FileSystemDirectoryHandle,
      targetDirHandle: nextTargetDir,
    });
  }
}

export async function renameDirectoryFallback(params: {
  sourceDirHandle: FileSystemDirectoryHandle;
  sourceName: string;
  parentDirHandle: FileSystemDirectoryHandle;
  newName: string;
}): Promise<void> {
  const nextDir = await params.parentDirHandle.getDirectoryHandle(params.newName, {
    create: true,
  });
  await copyDirectoryRecursive({
    sourceDirHandle: params.sourceDirHandle,
    targetDirHandle: nextDir,
  });
  await params.parentDirHandle.removeEntry(params.sourceName, { recursive: true });
}
