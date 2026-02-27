import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { convertSvgToPng } from '~/utils/svg';
import { SOURCES_DIR_NAME } from '~/utils/constants';
import { getClipThumbnailsHash, thumbnailGenerator } from '~/utils/thumbnail-generator';

interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

type FsFileHandleWithMove = FileSystemFileHandle & {
  move?: (name: string) => Promise<void>;
};

export interface FsEntry {
  name: string;
  kind: 'file' | 'directory';
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  parentHandle?: FileSystemDirectoryHandle;
  children?: FsEntry[];
  expanded?: boolean;
  path?: string;
  lastModified?: number;
}

type FileTreeSortMode = 'name' | 'modified';

export function isMoveAllowed(params: { sourcePath: string; targetDirPath: string }): boolean {
  const source = params.sourcePath
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/');
  const target = params.targetDirPath
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('/');

  if (!source) return false;
  if (!target) return true;
  if (target === source) return false;
  if (target.startsWith(`${source}/`)) return false;
  return true;
}

const rootEntries = ref<FsEntry[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);
const sortMode = ref<FileTreeSortMode>('name');

export function useFileManager() {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const mediaStore = useMediaStore();
  const proxyStore = useProxyStore();

  const isApiSupported = workspaceStore.isApiSupported;

  async function getProjectRootDirHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return null;
    return await workspaceStore.projectsHandle.getDirectoryHandle(projectStore.currentProjectName);
  }

  async function assertEntryDoesNotExist(params: {
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

  async function copyFileToDirectory(params: {
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

  async function copyDirectoryRecursive(params: {
    sourceDirHandle: FileSystemDirectoryHandle;
    targetDirHandle: FileSystemDirectoryHandle;
  }): Promise<void> {
    const iterator =
      (params.sourceDirHandle as FsDirectoryHandleWithIteration).values?.() ??
      (params.sourceDirHandle as FsDirectoryHandleWithIteration).entries?.();
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
      } else {
        const nextTargetDir = await params.targetDirHandle.getDirectoryHandle(handle.name, {
          create: true,
        });
        await copyDirectoryRecursive({
          sourceDirHandle: handle as FileSystemDirectoryHandle,
          targetDirHandle: nextTargetDir,
        });
      }
    }
  }

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

    if (sortMode.value === 'modified') {
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
    try {
      const iterator =
        (dirHandle as FsDirectoryHandleWithIteration).values?.() ??
        (dirHandle as FsDirectoryHandleWithIteration).entries?.();
      if (!iterator) return entries;

      for await (const value of iterator) {
        const handle = (Array.isArray(value) ? value[1] : value) as
          | FileSystemFileHandle
          | FileSystemDirectoryHandle;
        entries.push({
          name: handle.name,
          kind: handle.kind,
          handle,
          parentHandle: dirHandle,
          children: undefined,
          expanded: false,
          path: basePath ? `${basePath}/${handle.name}` : handle.name,
          lastModified: undefined,
        });
      }
    } catch (e: any) {
      throw new Error(e?.message ?? 'Failed to read directory');
    }

    if (sortMode.value === 'modified') {
      await attachLastModified(entries);
    }

    const videoPaths = entries
      .filter((e) => e.kind === 'file' && e.path?.startsWith(`${SOURCES_DIR_NAME}/video/`))
      .map((e) => e.path!);
    if (videoPaths.length > 0) {
      await proxyStore.checkExistingProxies(videoPaths);
    }

    return entries.sort(compareEntries);
  }

  function mergeEntries(prev: FsEntry[] | undefined, next: FsEntry[]): FsEntry[] {
    if (!prev || prev.length === 0) return next;

    const prevByPath = new Map<string, FsEntry>();
    for (const p of prev) {
      if (p.path) prevByPath.set(p.path, p);
    }

    for (const n of next) {
      if (!n.path) continue;
      const p = prevByPath.get(n.path);
      if (!p) continue;

      n.expanded = p.expanded;
      if (n.kind === 'directory') {
        n.children = p.children;
      }
      if (n.kind === 'file') {
        n.lastModified = p.lastModified;
      }
    }

    return next;
  }

  function findEntryByPath(path: string): FsEntry | null {
    const normalized = path
      .split('/')
      .map((p) => p.trim())
      .filter(Boolean)
      .join('/');
    if (!normalized) return null;

    function walk(list: FsEntry[]): FsEntry | null {
      for (const entry of list) {
        if (entry.path === normalized) return entry;
        if (
          entry.kind === 'directory' &&
          Array.isArray(entry.children) &&
          entry.children.length > 0
        ) {
          const found = walk(entry.children);
          if (found) return found;
        }
      }
      return null;
    }

    return walk(rootEntries.value);
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
      } catch {
        // ignore
      }

      if (entry.children) {
        await refreshExpandedChildren(entry.children);
      }
    }
  }

  async function toggleDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;
    error.value = null;
    entry.expanded = !entry.expanded;

    if (entry.path) {
      if (projectStore.currentProjectName) {
        uiStore.setFileTreePathExpanded(
          projectStore.currentProjectName,
          entry.path,
          entry.expanded,
        );
      }
    }

    if (entry.expanded && entry.children === undefined) {
      try {
        entry.children = await readDirectory(entry.handle as FileSystemDirectoryHandle, entry.path);
      } catch (e: any) {
        error.value = e?.message ?? 'Failed to read folder';
        entry.expanded = false;

        if (entry.path) {
          if (projectStore.currentProjectName) {
            uiStore.setFileTreePathExpanded(projectStore.currentProjectName, entry.path, false);
          }
        }
      }
    }
  }

  async function expandPersistedDirectories() {
    const projectName = projectStore.currentProjectName;
    if (!projectName) return;

    const expandedPaths = Object.keys(uiStore.fileTreeExpandedPaths);
    if (expandedPaths.length === 0) return;

    const sortedPaths = [...expandedPaths].sort((a, b) => a.length - b.length);

    for (const path of sortedPaths) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 0) continue;

      let currentList = rootEntries.value;
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

        if (!uiStore.isFileTreePathExpanded(currentPath)) {
          uiStore.setFileTreePathExpanded(projectName, currentPath, true);
        }

        currentList = entry.children ?? [];
      }
    }
  }

  async function loadProjectDirectory() {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) {
      rootEntries.value = [];
      return;
    }

    error.value = null;
    isLoading.value = true;
    try {
      const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
        projectStore.currentProjectName,
      );
      const nextRoot = await readDirectory(projectDir);
      rootEntries.value = mergeEntries(rootEntries.value, nextRoot);

      await refreshExpandedChildren(rootEntries.value);

      await expandPersistedDirectories();

      // Automatically expand the sources directory if present
      for (const entry of rootEntries.value) {
        if (entry.kind === 'directory' && entry.name === 'sources') {
          if (!entry.expanded) await toggleDirectory(entry);
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        error.value = e?.message ?? 'Failed to open project folder';
      }
    } finally {
      isLoading.value = false;
    }
  }

  async function handleFiles(
    files: FileList | File[],
    targetDirHandle?: FileSystemDirectoryHandle,
    targetDirPath?: string,
  ) {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    error.value = null;
    isLoading.value = true;
    try {
      const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
        projectStore.currentProjectName,
      );
      const sourcesDir = await projectDir.getDirectoryHandle('sources', { create: true });

      for (let file of Array.from(files)) {
        if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
          try {
            file = await convertSvgToPng(file, {
              maxWidth: projectStore.projectSettings.export.width,
              maxHeight: projectStore.projectSettings.export.height,
            });
          } catch (e) {
            console.warn('Failed to convert SVG to PNG', e);
            error.value = `Failed to import SVG: ${file.name}`;
            continue;
          }
        }

        let targetDir = targetDirHandle;
        let finalRelativePathBase = targetDirPath || 'sources';

        if (!targetDir) {
          let targetDirName = 'video';
          if (file.type.startsWith('audio/')) targetDirName = 'audio';
          else if (file.type.startsWith('image/')) targetDirName = 'images';
          else if (!file.type.startsWith('video/')) {
            if (file.name.endsWith('.otio')) continue; // Skip project files
          }
          targetDir = await sourcesDir.getDirectoryHandle(targetDirName, { create: true });
          finalRelativePathBase = `sources/${targetDirName}`;
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
          // If we drop inside a folder, we need the path relative to the project root
          // targetDirPath gives us something like "sources/video/my_folder"
          const projectRelativePath = `${finalRelativePathBase}/${file.name}`;
          void mediaStore.getOrFetchMetadata(fileHandle, projectRelativePath);
        }
      }

      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to upload files';
    } finally {
      isLoading.value = false;
    }
  }

  async function createFolder(name: string, targetEntry: FileSystemDirectoryHandle | null = null) {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    error.value = null;
    isLoading.value = true;
    try {
      const baseDir =
        targetEntry ||
        (await workspaceStore.projectsHandle.getDirectoryHandle(projectStore.currentProjectName));
      await baseDir.getDirectoryHandle(name, { create: true });
      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to create folder';
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteEntry(target: FsEntry) {
    error.value = null;
    isLoading.value = true;
    try {
      const parent = target.parentHandle;
      if (parent) {
        await parent.removeEntry(target.name, { recursive: true });
      }
      if (target.path && target.kind === 'file') {
        await proxyStore.deleteProxy(target.path);

        if (target.path.startsWith(`${SOURCES_DIR_NAME}/video/`)) {
          if (projectStore.currentProjectId) {
            await thumbnailGenerator.clearThumbnails({
              projectId: projectStore.currentProjectId,
              hash: getClipThumbnailsHash({
                projectId: projectStore.currentProjectId,
                projectRelativePath: target.path,
              }),
            });
          }
        }
      }
      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to delete';
    } finally {
      isLoading.value = false;
    }
  }

  async function renameEntry(target: FsEntry, newName: string) {
    if (!target.parentHandle) return;

    error.value = null;
    isLoading.value = true;
    try {
      const parent = target.parentHandle;

      try {
        if (target.kind === 'file') {
          await parent.getFileHandle(newName);
        } else {
          await parent.getDirectoryHandle(newName);
        }
        throw new Error(`Target name already exists: ${newName}`);
      } catch (e: any) {
        if (e?.name !== 'NotFoundError') throw e;
      }

      if (target.kind === 'file') {
        const handle = target.handle as FsFileHandleWithMove;
        if (typeof handle.move === 'function') {
          await handle.move(newName);
        } else {
          const file = await (handle as FileSystemFileHandle).getFile();
          const newHandle = await parent.getFileHandle(newName, { create: true });
          if (typeof (newHandle as FileSystemFileHandle).createWritable !== 'function') {
            throw new Error('Failed to rename file: createWritable is not available');
          }
          const writable = await (newHandle as FileSystemFileHandle).createWritable();
          await writable.write(file);
          await writable.close();
          await parent.removeEntry(target.name);
        }
      } else {
        const dirHandle = target.handle as unknown as { move?: (name: string) => Promise<void> };
        if (typeof dirHandle.move !== 'function') {
          throw new Error('Rename directory is not supported in this browser');
        }
        await dirHandle.move(newName);
      }

      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to rename';
    } finally {
      isLoading.value = false;
    }
  }

  async function moveEntry(params: {
    source: FsEntry;
    targetDirHandle: FileSystemDirectoryHandle;
    targetDirPath: string;
  }) {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;
    if (!params.source.parentHandle) return;

    const sourcePath = params.source.path ?? '';
    const targetDirPath = params.targetDirPath ?? '';
    if (!sourcePath) return;

    const sourceParentPath = sourcePath.split('/').slice(0, -1).join('/');
    if (sourceParentPath === targetDirPath) return;

    if (!isMoveAllowed({ sourcePath, targetDirPath })) return;

    error.value = null;
    isLoading.value = true;
    try {
      await assertEntryDoesNotExist({
        targetDirHandle: params.targetDirHandle,
        entryName: params.source.name,
        kind: params.source.kind,
      });

      if (params.source.kind === 'file') {
        await copyFileToDirectory({
          sourceHandle: params.source.handle as FileSystemFileHandle,
          fileName: params.source.name,
          targetDirHandle: params.targetDirHandle,
        });
        await params.source.parentHandle.removeEntry(params.source.name);

        const oldPath = sourcePath;
        const newPath = targetDirPath
          ? `${targetDirPath}/${params.source.name}`
          : params.source.name;

        delete mediaStore.mediaMetadata[oldPath];
        delete mediaStore.mediaMetadata[newPath];

        if (oldPath.startsWith(`${SOURCES_DIR_NAME}/video/`)) {
          await proxyStore.deleteProxy(oldPath);
          proxyStore.existingProxies.clear();

          if (projectStore.currentProjectId) {
            await thumbnailGenerator.clearThumbnails({
              projectId: projectStore.currentProjectId,
              hash: getClipThumbnailsHash({
                projectId: projectStore.currentProjectId,
                projectRelativePath: oldPath,
              }),
            });
          }
        }
      } else {
        const targetDir = await params.targetDirHandle.getDirectoryHandle(params.source.name, {
          create: true,
        });
        await copyDirectoryRecursive({
          sourceDirHandle: params.source.handle as FileSystemDirectoryHandle,
          targetDirHandle: targetDir,
        });
        await params.source.parentHandle.removeEntry(params.source.name, { recursive: true });

        mediaStore.resetMediaState();
        proxyStore.existingProxies.clear();
      }

      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to move';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function createTimeline() {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    error.value = null;
    isLoading.value = true;
    try {
      const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
        projectStore.currentProjectName,
      );
      const sourcesDir = await projectDir.getDirectoryHandle('sources', { create: true });
      const timelinesDir = await sourcesDir.getDirectoryHandle('timelines', { create: true });

      // Find unique filename
      let index = 1;
      let fileName = '';
      let exists = true;
      while (exists) {
        fileName = `timeline_${String(index).padStart(3, '0')}.otio`;
        try {
          await timelinesDir.getFileHandle(fileName);
          index++;
        } catch (e) {
          exists = false;
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

      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to create timeline';
    } finally {
      isLoading.value = false;
    }
  }

  function getFileIcon(entry: FsEntry): string {
    if (entry.kind === 'directory') return 'i-heroicons-folder';
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'i-heroicons-film';
    if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'i-heroicons-musical-note';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'i-heroicons-photo';
    if (ext === 'otio') return 'i-heroicons-document-text';
    return 'i-heroicons-document';
  }

  return {
    rootEntries,
    isLoading,
    error,
    isApiSupported,
    getProjectRootDirHandle,
    sortMode,
    setSortMode: (v: FileTreeSortMode) => {
      sortMode.value = v;
    },
    loadProjectDirectory,
    toggleDirectory,
    handleFiles,
    createFolder,
    deleteEntry,
    renameEntry,
    findEntryByPath,
    moveEntry,
    createTimeline,
    getFileIcon,
  };
}
