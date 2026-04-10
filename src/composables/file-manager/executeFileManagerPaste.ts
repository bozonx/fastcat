import { crossVfsCopy, crossVfsMove } from '~/file-manager/core/vfs/crossVfs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import type { FileManagerClipboardPayload } from '~/stores/clipboard.store';
import type { FsEntry } from '~/types/fs';

interface ExecuteFileManagerPasteOptions {
  payload: FileManagerClipboardPayload;
  targetEntry: FsEntry | FsEntry[] | null | undefined;
  targetVfs: IFileSystemAdapter;
  getSourceVfs: (instanceId?: string | null) => IFileSystemAdapter | null;
  findEntryByPath: (path: string) => FsEntry | null;
  copyEntry: (params: {
    source: FsEntry;
    targetDirPath: string;
  }) => Promise<string | null | unknown>;
  moveEntry: (params: {
    source: FsEntry;
    targetDirPath: string;
  }) => Promise<string | null | unknown>;
  reloadDirectory: (path: string) => Promise<void>;
  notifyFileManagerUpdate?: () => void;
  setFileTreePathExpanded?: (path: string, expanded: boolean) => void;
  onFileSelect?: (entry: FsEntry) => void;
  onFilesSelect?: (entries: FsEntry[]) => void;
  clearClipboardPayload?: () => void;
}

function resolveTargetDirPath(entry: FsEntry | FsEntry[] | null | undefined): string {
  const targetEntry = Array.isArray(entry) ? entry[0] : entry;
  if (!targetEntry) return '';

  if (targetEntry.kind === 'directory') {
    return targetEntry.path ?? '';
  }

  return (
    targetEntry.parentPath ??
    (targetEntry.path ? targetEntry.path.split('/').slice(0, -1).join('/') : '')
  );
}

function buildSyntheticEntry(item: FileManagerClipboardPayload['items'][number]): FsEntry {
  return {
    kind: item.kind,
    name: item.name,
    path: item.path,
    source: item.source,
  } as FsEntry;
}

function normalizePastedPath(resultPath: string | null | unknown, fallbackPath: string): string {
  return typeof resultPath === 'string' && resultPath.length > 0 ? resultPath : fallbackPath;
}

export async function executeFileManagerPaste(options: ExecuteFileManagerPasteOptions) {
  const targetDirPath = resolveTargetDirPath(options.targetEntry);
  if (targetDirPath) {
    options.setFileTreePathExpanded?.(targetDirPath, true);
  }

  const sourceVfs = options.getSourceVfs(options.payload.sourceInstanceId);
  const shouldUseCrossVfs = Boolean(sourceVfs && sourceVfs !== options.targetVfs);
  const pastedPaths: string[] = [];

  for (const item of options.payload.items) {
    const fallbackPath = targetDirPath ? `${targetDirPath}/${item.name}` : item.name;

    if (shouldUseCrossVfs && sourceVfs) {
      const resultPath =
        options.payload.operation === 'copy'
          ? await crossVfsCopy({
              sourceVfs,
              targetVfs: options.targetVfs,
              sourcePath: item.path,
              sourceKind: item.kind,
              targetDirPath,
            })
          : await crossVfsMove({
              sourceVfs,
              targetVfs: options.targetVfs,
              sourcePath: item.path,
              sourceKind: item.kind,
              targetDirPath,
            });

      pastedPaths.push(normalizePastedPath(resultPath, fallbackPath));
      continue;
    }

    const sourceEntry = options.findEntryByPath(item.path) ?? buildSyntheticEntry(item);
    const resultPath =
      options.payload.operation === 'copy'
        ? await options.copyEntry({ source: sourceEntry, targetDirPath })
        : await options.moveEntry({ source: sourceEntry, targetDirPath });

    pastedPaths.push(normalizePastedPath(resultPath, fallbackPath));
  }

  if (options.payload.operation === 'cut') {
    options.clearClipboardPayload?.();
  }

  await options.reloadDirectory(targetDirPath);
  options.notifyFileManagerUpdate?.();

  setTimeout(() => {
    const entries = pastedPaths
      .map((path) => options.findEntryByPath(path))
      .filter((entry): entry is FsEntry => Boolean(entry));

    if (entries.length === 0) return;

    if (entries.length === 1) {
      options.onFileSelect?.(entries[0]);
      return;
    }

    options.onFilesSelect?.(entries);
  }, 50);
}
