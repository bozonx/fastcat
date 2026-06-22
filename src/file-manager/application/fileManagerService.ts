import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import {
  findEntryByPath as findEntryByPathCore,
  mergeEntries as mergeEntriesCore,
  updateEntryByPath,
} from '~/file-manager/core/tree';
import {
  AUDIO_DIR_NAME,
  DOCUMENTS_DIR_NAME,
  FILES_DIR_NAME,
  IMAGES_DIR_NAME,
  VIDEO_DIR_NAME,
} from '~/utils/constants';

export interface FileManagerServiceDeps {
  rootEntries: Ref<FsEntry[]>;
  sortMode: Ref<'name' | 'type'>;
  showHiddenFiles: () => boolean;
  hasPersistedFileTreeState?: () => boolean;
  isPathExpanded: (path: string) => boolean;
  setPathExpanded: (path: string, expanded: boolean) => void;
  getExpandedPaths: () => string[];
  vfs: IFileSystemAdapter;
  checkExistingProxies: (videoPaths: string[]) => Promise<void>;
  onError?: (params: { title?: string; message: string; error?: unknown }) => void;
  onDirectoryLoaded?: () => void;
  onDirectoryMoved?: (params: { oldPath: string; newPath: string }) => void | Promise<void>;
  onDirectoryCopied?: (params: { oldPath: string; newPath: string }) => void | Promise<void>;
}

export interface FileManagerService {
  readDirectory: (path?: string, options?: { checkChildren?: boolean }) => Promise<FsEntry[]>;
  findEntryByPath: (path: string) => FsEntry | null;
  mergeEntries: (prev: FsEntry[] | undefined, next: FsEntry[]) => FsEntry[];
  toggleDirectory: (entry: FsEntry) => Promise<void>;
  ensureDirectoryExpanded: (entry: FsEntry) => Promise<void>;
  refreshExpandedChildren: (entries: FsEntry[]) => Promise<void>;
  expandPersistedDirectories: () => Promise<void>;
  loadProjectDirectory: (
    rootPath?: string,
    options?: {
      refreshExpandedChildren?: boolean;
      expandPersistedDirectories?: boolean;
      autoExpandMediaDirs?: boolean;
    },
  ) => Promise<void>;
  reloadDirectory: (path: string) => Promise<void>;
}

// Treat any letter or number from any script as alphanumeric, falling back to
// the legacy ASCII+Cyrillic range when Unicode property escapes are unsupported.
const ALPHANUMERIC_FIRST_CHAR_REGEX = (() => {
  try {
    return new RegExp('^[\\p{L}\\p{N}]', 'u');
  } catch {
    return /^[a-zA-Z0-9\u0400-\u04FF]/;
  }
})();

function isFsNameAlphanumeric(name: string): boolean {
  return ALPHANUMERIC_FIRST_CHAR_REGEX.test(name.charAt(0));
}

export function createFileManagerService(deps: FileManagerServiceDeps): FileManagerService {
  function compareEntries(a: FsEntry, b: FsEntry): number {
    // 1. Kind (directory first)
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;

    // 2. Hidden entries (starting with .) - ALWAYS at the very top of their kind
    const aIsHidden = a.name.startsWith('.');
    const bIsHidden = b.name.startsWith('.');
    if (aIsHidden !== bIsHidden) {
      return aIsHidden ? -1 : 1;
    }

    // 3. Special characters (non-alphanumeric) - ABOVE letters/numbers but BELOW hidden
    const aIsAlpha = isFsNameAlphanumeric(a.name);
    const bIsAlpha = isFsNameAlphanumeric(b.name);

    if (aIsAlpha !== bIsAlpha) {
      return aIsAlpha ? 1 : -1; // Special comes first
    }

    // 4. Alphabetical sort
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }

  // Throws on adapter failure; callers must decide whether to surface the error
  // or fall back to existing state. Returning [] here would conflate a failed
  // read with an empty directory and let mergeEntries wipe out expanded children.
  async function readDirectory(
    path = '',
    options?: { checkChildren?: boolean },
  ): Promise<FsEntry[]> {
    const checkChildren = options?.checkChildren ?? false;
    const entries = await deps.vfs.readDirectory(path, { checkChildren });

    const normalizedEntries = entries
      .filter((entry) => deps.showHiddenFiles() || !entry.name.startsWith('.'))
      .map(
        (entry) =>
          ({
            name: entry.name,
            kind: entry.kind,
            children: undefined,
            expanded: deps.isPathExpanded(entry.path),
            path: entry.path,
            parentPath: entry.parentPath,
            lastModified: entry.lastModified,
            size: entry.size,
            // Unknown child state remains optimistic until the tree performs an exact read.
            hasChildren: entry.kind === 'directory' ? (entry.hasChildren ?? true) : false,
            hasDirectories: entry.kind === 'directory' ? (entry.hasDirectories ?? true) : false,
          }) satisfies FsEntry,
      );

    const videoPaths = normalizedEntries
      .filter(
        (e) =>
          e.kind === 'file' &&
          (e.path.startsWith(`${VIDEO_DIR_NAME}/`) || e.path.includes(`/${VIDEO_DIR_NAME}/`)),
      )
      .map((e) => e.path);
    if (videoPaths.length > 0) {
      await deps.checkExistingProxies(videoPaths);
    }

    const seenPaths = new Set<string>();
    const uniqueEntries = normalizedEntries.filter((e) => {
      if (seenPaths.has(e.path)) return false;
      seenPaths.add(e.path);
      return true;
    });

    return uniqueEntries.sort(compareEntries);
  }

  function readTreeDirectory(path = ''): Promise<FsEntry[]> {
    return readDirectory(path, { checkChildren: true });
  }

  function withLoadedChildrenState(entry: FsEntry, children: FsEntry[]): FsEntry {
    return {
      ...entry,
      children,
      hasChildren: children.length > 0,
      hasDirectories: children.some((child) => child.kind === 'directory'),
    };
  }

  function reportReadError(path: string, error: unknown): void {
    deps.onError?.({
      title: 'File manager error',
      message: `Failed to read directory${path ? `: ${path}` : ''}`,
      error,
    });
  }

  function mergeEntries(prev: FsEntry[] | undefined, next: FsEntry[]): FsEntry[] {
    return mergeEntriesCore(prev, next, {
      isPathExpanded: (path) => deps.isPathExpanded(path),
    });
  }

  function findEntryByPath(path: string): FsEntry | null {
    return findEntryByPathCore(deps.rootEntries.value, path);
  }

  async function toggleDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;

    const path = entry.path;
    if (!path) return;

    const current = findEntryByPathCore(deps.rootEntries.value, path);
    if (!current || current.kind !== 'directory') return;

    const nextExpanded = !current.expanded;

    const applyExpandedState = (expanded: boolean) => {
      deps.rootEntries.value = updateEntryByPath(deps.rootEntries.value, path, (e) => ({
        ...e,
        expanded,
      }));
      deps.setPathExpanded(path, expanded);
    };

    if (!nextExpanded) {
      applyExpandedState(false);
      return;
    }

    applyExpandedState(true);

    const afterExpand = findEntryByPathCore(deps.rootEntries.value, path);
    if (!afterExpand || afterExpand.kind !== 'directory') return;

    try {
      const children = await readTreeDirectory(path);
      deps.rootEntries.value = updateEntryByPath(deps.rootEntries.value, path, (e) =>
        withLoadedChildrenState(e, mergeEntries(e.children, children)),
      );
      deps.onDirectoryLoaded?.();
    } catch (e) {
      applyExpandedState(false);
      deps.onError?.({
        title: 'File manager error',
        message: `Failed to read folder: ${path}`,
        error: e,
      });
    }
  }

  /**
   * Expand a directory and guarantee its children are loaded. Unlike
   * {@link toggleDirectory}, this never collapses and it loads children even
   * when the directory is already flagged `expanded` but its `children` are
   * still `undefined` (e.g. restored-from-persisted expansion state). This is
   * what "reveal in file manager" needs while walking down a path — relying on
   * the `expanded` flag alone intermittently leaves ancestors unloaded, so the
   * target entry can't be found and never gets selected.
   */
  async function ensureDirectoryExpanded(entry: FsEntry): Promise<void> {
    if (entry.kind !== 'directory') return;

    const path = entry.path;
    if (!path) return;

    const current = findEntryByPathCore(deps.rootEntries.value, path);
    if (!current || current.kind !== 'directory') return;

    if (!current.expanded) {
      deps.rootEntries.value = updateEntryByPath(deps.rootEntries.value, path, (e) => ({
        ...e,
        expanded: true,
      }));
      deps.setPathExpanded(path, true);
    }

    const afterExpand = findEntryByPathCore(deps.rootEntries.value, path);
    if (!afterExpand || afterExpand.kind !== 'directory') return;
    if (afterExpand.children !== undefined) return;

    try {
      const children = await readTreeDirectory(path);
      deps.rootEntries.value = updateEntryByPath(deps.rootEntries.value, path, (e) =>
        withLoadedChildrenState(e, mergeEntries(e.children, children)),
      );
      deps.onDirectoryLoaded?.();
    } catch (e) {
      deps.onError?.({
        title: 'File manager error',
        message: `Failed to read folder: ${path}`,
        error: e,
      });
    }
  }

  async function refreshExpandedChildren(entries: FsEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.kind !== 'directory') continue;
      if (entry.children === undefined) continue;

      let refreshedChildren = entry.children;
      try {
        const nextChildren = await readTreeDirectory(entry.path);
        if (entry.path) {
          refreshedChildren = mergeEntries(entry.children, nextChildren);
          deps.rootEntries.value = updateEntryByPath(
            deps.rootEntries.value,
            entry.path,
            (current) => withLoadedChildrenState(current, refreshedChildren),
          );
        }
      } catch (e) {
        reportReadError(entry.path, e);
      }

      await refreshExpandedChildren(refreshedChildren);
    }
  }

  async function expandPersistedDirectories() {
    const expandedPaths = deps.getExpandedPaths();
    if (expandedPaths.length === 0) return;

    const sortedPaths = [...expandedPaths].sort((a, b) => a.length - b.length);

    for (const path of sortedPaths) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 0) continue;

      let currentList = deps.rootEntries.value;
      let currentPath = '';

      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const entry = currentList.find((e) => e.kind === 'directory' && e.name === part);
        if (!entry) break;

        if (!entry.expanded) {
          await toggleDirectory(entry);
        } else if (entry.children === undefined) {
          try {
            const children = await readTreeDirectory(entry.path);
            deps.rootEntries.value = updateEntryByPath(
              deps.rootEntries.value,
              entry.path,
              (current) =>
                withLoadedChildrenState(current, mergeEntries(current.children, children)),
            );
          } catch (e) {
            reportReadError(entry.path, e);
            break;
          }
        }

        if (!deps.isPathExpanded(currentPath)) {
          deps.setPathExpanded(currentPath, true);
        }

        const refreshed = findEntryByPathCore(deps.rootEntries.value, currentPath);
        currentList = refreshed?.children ?? [];
      }
    }
  }

  async function loadProjectDirectory(
    rootPath = '',
    options?: {
      refreshExpandedChildren?: boolean;
      expandPersistedDirectories?: boolean;
      autoExpandMediaDirs?: boolean;
    },
  ) {
    const {
      refreshExpandedChildren: shouldRefreshExpandedChildren = false,
      expandPersistedDirectories: shouldExpandPersistedDirectories = true,
      autoExpandMediaDirs: shouldAutoExpandMediaDirs = true,
    } = options ?? {};

    let nextRoot: FsEntry[];
    try {
      nextRoot = await readTreeDirectory(rootPath);
    } catch (e) {
      // Preserve existing rootEntries on read failure; never overwrite with [].
      reportReadError(rootPath, e);
      return;
    }
    deps.rootEntries.value = mergeEntries(deps.rootEntries.value, nextRoot);

    if (shouldRefreshExpandedChildren) {
      await refreshExpandedChildren(deps.rootEntries.value);
    }

    if (shouldExpandPersistedDirectories) {
      await expandPersistedDirectories();
    }

    if (deps.hasPersistedFileTreeState?.()) {
      deps.onDirectoryLoaded?.();
      return;
    }

    if (!shouldAutoExpandMediaDirs) {
      deps.onDirectoryLoaded?.();
      return;
    }

    const mediaDirs = deps.rootEntries.value.filter(
      (entry) =>
        entry.kind === 'directory' &&
        (entry.name === VIDEO_DIR_NAME ||
          entry.name === AUDIO_DIR_NAME ||
          entry.name === FILES_DIR_NAME ||
          entry.name === DOCUMENTS_DIR_NAME ||
          entry.name === IMAGES_DIR_NAME) &&
        !entry.expanded,
    );
    await Promise.all(mediaDirs.map((entry) => toggleDirectory(entry)));

    deps.onDirectoryLoaded?.();
  }

  async function reloadDirectory(path: string) {
    if (!path) {
      try {
        const nextRoot = await readTreeDirectory('');
        deps.rootEntries.value = mergeEntries(deps.rootEntries.value, nextRoot);
        deps.onDirectoryLoaded?.();
      } catch (e) {
        reportReadError('', e);
      }
      return;
    }
    const entry = findEntryByPath(path);
    if (!entry || entry.kind !== 'directory') return;
    try {
      const nextChildren = await readTreeDirectory(path);
      deps.rootEntries.value = updateEntryByPath(deps.rootEntries.value, path, (entry) =>
        withLoadedChildrenState(
          {
            ...entry,
            expanded: deps.isPathExpanded(path),
          },
          mergeEntries(entry.children, nextChildren),
        ),
      );
      deps.onDirectoryLoaded?.();
    } catch (e) {
      reportReadError(path, e);
    }
  }

  return {
    readDirectory,
    findEntryByPath,
    mergeEntries,
    toggleDirectory,
    ensureDirectoryExpanded,
    refreshExpandedChildren,
    expandPersistedDirectories,
    loadProjectDirectory,
    reloadDirectory,
  };
}
