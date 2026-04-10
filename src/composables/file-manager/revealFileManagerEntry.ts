import type { FsEntry } from '~/types/fs';
import { normalizeWorkspaceFilePath } from '~/utils/workspace-common';

interface RevealFileManagerEntryOptions {
  path: string;
  loadProjectDirectory: () => Promise<void>;
  notifyFileManagerUpdate?: () => void;
  beforeReveal?: () => void | Promise<void>;
  findEntryByPath: (path: string) => FsEntry | null | undefined;
  toggleDirectory: (entry: FsEntry) => Promise<void>;
  openFolder: (entry: FsEntry) => void;
  selectEntry: (entry: FsEntry) => void;
  setSelectedFsEntry: (entry: FsEntry) => void;
  focusFileManager?: () => void;
  scrollToEntry?: (path: string) => void;
}

export async function revealFileManagerEntry(options: RevealFileManagerEntryOptions) {
  const normalizedPath = normalizeWorkspaceFilePath(options.path);
  if (!normalizedPath) return null;

  await options.beforeReveal?.();
  await options.loadProjectDirectory();
  options.notifyFileManagerUpdate?.();

  const parts = normalizedPath.split('/').filter(Boolean);
  let currentPath = '';

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!part) continue;

    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const directoryEntry = options.findEntryByPath(currentPath);
    if (directoryEntry?.kind === 'directory' && !directoryEntry.expanded) {
      await options.toggleDirectory(directoryEntry);
    }
  }

  const entry = options.findEntryByPath(normalizedPath);
  if (!entry) return null;

  const parentPath = normalizedPath.split('/').slice(0, -1).join('/');
  if (parentPath) {
    const parentEntry = options.findEntryByPath(parentPath);
    if (parentEntry?.kind === 'directory') {
      options.openFolder(parentEntry);
    }
  }

  options.setSelectedFsEntry(entry);
  options.selectEntry(entry);
  options.scrollToEntry?.(entry.path ?? normalizedPath);
  options.focusFileManager?.();

  return entry;
}
