import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import {
  findEntryByPath as findEntryByPathCore,
  mergeEntries as mergeEntriesCore,
  updateEntryByPath,
} from '~/file-manager/core/tree';
import { AUDIO_DIR_NAME, DOCUMENTS_DIR_NAME, FILES_DIR_NAME, IMAGES_DIR_NAME, VIDEO_DIR_NAME } from '~/utils/constants';

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
  readDirectory: (path?: string) => Promise<FsEntry[]>;
  findEntryByPath: (path: string) => FsEntry | null;
  mergeEntries: (prev: FsEntry[] | undefined, next: FsEntry[]) => FsEntry[];
  toggleDirectory: (entry: FsEntry) => Promise<void>;
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
    const isAlphanumeric = (name: string) => /^[a-zA-Z0-9\u0400-\u04FF]/.test(name.charAt(0));
    const aIsAlpha = isAlphanumeric(a.name);
    const bIsAlpha = isAlphanumeric(b.name);

    if (aIsAlpha !== bIsAlpha) {
      return aIsAlpha ? 1 : -1; // Special comes first
    }

    // 4. Alphabetical sort
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }

  async function readDirectory(path = ''): Promise<FsEntry[]> {
    try {
      const entries = await deps.vfs.readDirectory(path);

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
              hasChildren: entry.hasChildren,
              hasDirectories: entry.hasDirectories,
            }) satisfies FsEntry,
        );

      const videoPaths = normalizedEntries
        .filter((e) => e.kind === 'file' && e.path.startsWith(`${VIDEO_DIR_NAME}/`))
        .map((e) => e.path);
      if (videoPaths.length > 0) {
        await deps.checkExistingProxies(videoPaths);
      }

      return normalizedEntries.sort(compareEntries);
    } catch (e) {
      deps.onError?.({
        title: 'File manager error',
        message: `Failed to read directory${path ? `: ${path}` : ''}`,
        error: e,
      });
      return [];
    }
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
    if (afterExpand.children !== undefined) return;

    try {
      const children = await readDirectory(path);
      deps.rootEntries.value = updateEntryByPath(deps.rootEntries.value, path, (e) => ({
        ...e,
        children,
      }));
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

  async function refreshExpandedChildren(entries: FsEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.kind !== 'directory') continue;
      if (!entry.expanded) continue;
      if (entry.children === undefined) continue;

      try {
        const nextChildren = await readDirectory(entry.path);
        if (entry.path) {
          const merged = mergeEntries(entry.children, nextChildren);
          deps.rootEntries.value = updateEntryByPath(deps.rootEntries.value, entry.path, (e) => ({
            ...e,
            children: merged,
          }));
        }
      } catch (e) {
        deps.onError?.({
          title: 'File manager error',
          message: `Failed to refresh directory${entry.path ? `: ${entry.path}` : ''}`,
          error: e,
        });
      }

      if (entry.children) {
        await refreshExpandedChildren(entry.children);
      }
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
          entry.children = await readDirectory(entry.path);
        }

        if (!deps.isPathExpanded(currentPath)) {
          deps.setPathExpanded(currentPath, true);
        }

        currentList = entry.children ?? [];
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

    const nextRoot = await readDirectory(rootPath);
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

    for (const entry of deps.rootEntries.value) {
      if (
        entry.kind === 'directory' &&
        (entry.name === VIDEO_DIR_NAME ||
          entry.name === AUDIO_DIR_NAME ||
          entry.name === FILES_DIR_NAME ||
          entry.name === DOCUMENTS_DIR_NAME ||
          entry.name === IMAGES_DIR_NAME)
      ) {
        if (!entry.expanded) {
          await toggleDirectory(entry);
        }
      }
    }

    deps.onDirectoryLoaded?.();
  }

  async function reloadDirectory(path: string) {
    if (!path) {
      const nextRoot = await readDirectory('');
      deps.rootEntries.value = mergeEntries(deps.rootEntries.value, nextRoot);
      deps.onDirectoryLoaded?.();
      return;
    }
    const entry = findEntryByPath(path);
    if (!entry || entry.kind !== 'directory') return;
    try {
      const nextChildren = await readDirectory(path);
      deps.rootEntries.value = updateEntryByPath(deps.rootEntries.value, path, (e) => ({
        ...e,
        expanded: deps.isPathExpanded(path),
        children: mergeEntries(e.children, nextChildren),
      }));
      deps.onDirectoryLoaded?.();
    } catch (e) {
      deps.onError?.({
        title: 'File manager error',
        message: `Failed to reload directory: ${path}`,
        error: e,
      });
    }
  }

  return {
    readDirectory,
    findEntryByPath,
    mergeEntries,
    toggleDirectory,
    refreshExpandedChildren,
    expandPersistedDirectories,
    loadProjectDirectory,
    reloadDirectory,
  };
}
