import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import {
  findEntryByPath as findEntryByPathCore,
  mergeEntries as mergeEntriesCore,
} from '~/file-manager/core/tree';
import { AUDIO_DIR_NAME, FILES_DIR_NAME, IMAGES_DIR_NAME, VIDEO_DIR_NAME } from '~/utils/constants';

interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

export interface FileManagerServiceDeps {
  rootEntries: Ref<FsEntry[]>;
  sortMode: Ref<'name' | 'modified'>;
  showHiddenFiles: () => boolean;
  isPathExpanded: (path: string) => boolean;
  setPathExpanded: (path: string, expanded: boolean) => void;
  getExpandedPaths: () => string[];
  sanitizeHandle: <T extends object>(handle: T) => T;
  sanitizeParentHandle: (handle: FileSystemDirectoryHandle) => FileSystemDirectoryHandle;
  checkExistingProxies: (videoPaths: string[]) => Promise<void>;
  onError?: (params: { title?: string; message: string; error?: unknown }) => void;
}

export interface FileManagerService {
  readDirectory: (dirHandle: FileSystemDirectoryHandle, basePath?: string) => Promise<FsEntry[]>;
  findEntryByPath: (path: string) => FsEntry | null;
  mergeEntries: (prev: FsEntry[] | undefined, next: FsEntry[]) => FsEntry[];
  toggleDirectory: (entry: FsEntry) => Promise<void>;
  refreshExpandedChildren: (entries: FsEntry[]) => Promise<void>;
  expandPersistedDirectories: () => Promise<void>;
  loadProjectDirectory: (projectDir: FileSystemDirectoryHandle) => Promise<void>;
}

export function createFileManagerService(deps: FileManagerServiceDeps): FileManagerService {
  async function attachLastModified(entries: FsEntry[]): Promise<void> {
    const files = entries.filter((e) => e.kind === 'file') as FsEntry[];
    await Promise.all(
      files.map(async (entry) => {
        try {
          const file = await (entry.handle as FileSystemFileHandle).getFile();
          entry.lastModified = file.lastModified;
        } catch {
          entry.lastModified = undefined;
        }
      }),
    );
  }

  function compareEntries(a: FsEntry, b: FsEntry): number {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;

    if (deps.sortMode.value === 'modified') {
      const am = a.lastModified ?? 0;
      const bm = b.lastModified ?? 0;
      if (am !== bm) return bm - am;
    }

    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }

  async function readDirectory(
    dirHandle: FileSystemDirectoryHandle,
    basePath = '',
  ): Promise<FsEntry[]> {
    const entries: FsEntry[] = [];

    const iterator =
      (dirHandle as FsDirectoryHandleWithIteration).values?.() ??
      (dirHandle as FsDirectoryHandleWithIteration).entries?.();
    if (!iterator) {
      deps.onError?.({
        title: 'File manager error',
        message: 'Failed to read directory: iteration is not available',
      });
      return entries;
    }

    try {
      for await (const value of iterator) {
        const rawHandle = (Array.isArray(value) ? value[1] : value) as
          | FileSystemFileHandle
          | FileSystemDirectoryHandle;

        if (!deps.showHiddenFiles() && rawHandle.name.startsWith('.')) continue;

        const handle = deps.sanitizeHandle(rawHandle);
        const parentHandle = deps.sanitizeParentHandle(dirHandle);

        entries.push({
          name: handle.name,
          kind: handle.kind,
          handle,
          parentHandle,
          children: undefined,
          expanded: false,
          path: basePath ? `${basePath}/${handle.name}` : handle.name,
          lastModified: undefined,
        });
      }
    } catch (e) {
      deps.onError?.({
        title: 'File manager error',
        message: `Failed to read directory${basePath ? `: ${basePath}` : ''}`,
        error: e,
      });
      return entries;
    }

    if (deps.sortMode.value === 'modified') {
      await attachLastModified(entries);
    }

    const videoPaths = entries
      .filter((e) => e.kind === 'file' && e.path?.startsWith(`${VIDEO_DIR_NAME}/`))
      .map((e) => e.path!);
    if (videoPaths.length > 0) {
      await deps.checkExistingProxies(videoPaths);
    }

    return entries.sort(compareEntries);
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

    entry.expanded = !entry.expanded;

    if (entry.path) {
      deps.setPathExpanded(entry.path, Boolean(entry.expanded));
    }

    if (entry.expanded && entry.children === undefined) {
      entry.children = await readDirectory(entry.handle as FileSystemDirectoryHandle, entry.path);
    }
  }

  async function refreshExpandedChildren(entries: FsEntry[]): Promise<void> {
    for (const entry of entries) {
      if (entry.kind !== 'directory') continue;
      if (!entry.expanded) continue;
      if (entry.children === undefined) continue;

      try {
        const nextChildren = await readDirectory(
          entry.handle as FileSystemDirectoryHandle,
          entry.path,
        );
        entry.children = mergeEntries(entry.children, nextChildren);
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
          entry.children = await readDirectory(
            entry.handle as FileSystemDirectoryHandle,
            entry.path,
          );
        }

        if (!deps.isPathExpanded(currentPath)) {
          deps.setPathExpanded(currentPath, true);
        }

        currentList = entry.children ?? [];
      }
    }
  }

  async function loadProjectDirectory(projectDir: FileSystemDirectoryHandle) {
    const nextRoot = await readDirectory(projectDir);
    deps.rootEntries.value = mergeEntries(deps.rootEntries.value, nextRoot);

    await refreshExpandedChildren(deps.rootEntries.value);
    await expandPersistedDirectories();

    for (const entry of deps.rootEntries.value) {
      if (
        entry.kind === 'directory' &&
        (entry.name === VIDEO_DIR_NAME ||
          entry.name === AUDIO_DIR_NAME ||
          entry.name === FILES_DIR_NAME ||
          entry.name === IMAGES_DIR_NAME)
      ) {
        if (!entry.expanded) {
          await toggleDirectory(entry);
        }
      }
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
  };
}
