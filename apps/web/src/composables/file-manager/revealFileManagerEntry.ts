import type { FsEntry } from '~/types/fs';
import { normalizeWorkspaceFilePath } from '~/utils/workspace-common';

interface RevealFileManagerEntryOptions {
  path: string;
  loadProjectDirectory: () => Promise<void>;
  notifyFileManagerUpdate?: () => void;
  beforeReveal?: () => void | Promise<void>;
  findEntryByPath: (path: string) => FsEntry | null | undefined;
  toggleDirectory: (entry: FsEntry) => Promise<void>;
  /**
   * Expand a directory and ensure its children are loaded. Preferred over
   * {@link toggleDirectory} while walking down the path: a directory can be
   * flagged `expanded` while its children are still unloaded, in which case
   * relying on the flag leaves the target entry unfindable.
   */
  ensureDirectoryExpanded?: (entry: FsEntry) => Promise<void>;
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
    if (directoryEntry?.kind === 'directory') {
      // Expand *and* ensure children are loaded. A directory may already be
      // flagged `expanded` while its children are still `undefined` (restored
      // persisted state), so guarding on `!expanded` alone would skip loading
      // and leave the deeper entry — including the target file — unfindable.
      if (options.ensureDirectoryExpanded) {
        await options.ensureDirectoryExpanded(directoryEntry);
      } else if (!directoryEntry.expanded) {
        await options.toggleDirectory(directoryEntry);
      }
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
