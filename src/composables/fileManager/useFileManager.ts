import { ref, computed, toRaw, markRaw } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { convertSvgToPng } from '~/utils/svg';
import {
  SOURCES_DIR_NAME,
  VIDEO_DIR_NAME,
  AUDIO_DIR_NAME,
  IMAGES_DIR_NAME,
  FILES_DIR_NAME,
  TIMELINES_DIR_NAME,
} from '~/utils/constants';
import { getClipThumbnailsHash, thumbnailGenerator } from '~/utils/thumbnail-generator';
import type { FsEntry } from '~/types/fs';
import { isMoveAllowed as isMoveAllowedCore } from '~/file-manager/core/rules';
import {
  findEntryByPath as findEntryByPathCore,
  mergeEntries as mergeEntriesCore,
} from '~/file-manager/core/tree';
import {
  assertEntryDoesNotExist,
  copyDirectoryRecursive,
  copyFileToDirectory,
  renameDirectoryFallback,
} from '~/file-manager/fs/ops';

interface FsDirectoryHandleWithIteration extends FileSystemDirectoryHandle {
  values?: () => AsyncIterable<FileSystemHandle>;
  entries?: () => AsyncIterable<[string, FileSystemHandle]>;
}

type FsFileHandleWithMove = FileSystemFileHandle & {
  move?: (name: string) => Promise<void>;
};

type FileTreeSortMode = 'name' | 'modified';

export function isMoveAllowed(params: { sourcePath: string; targetDirPath: string }): boolean {
  return isMoveAllowedCore(params);
}

const rootEntries = ref<FsEntry[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);
const sortMode = ref<FileTreeSortMode>('name');

export function useFileManager() {
  const { t } = useI18n();
  const toast = useToast();
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const mediaStore = useMediaStore();
  const proxyStore = useProxyStore();

  const isApiSupported = workspaceStore.isApiSupported;

  watch(
    () => uiStore.showHiddenFiles,
    () => {
      void loadProjectDirectory();
    },
  );

  async function getProjectRootDirHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return null;
    return await workspaceStore.projectsHandle.getDirectoryHandle(projectStore.currentProjectName);
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
        let handle = (Array.isArray(value) ? value[1] : value) as
          | FileSystemFileHandle
          | FileSystemDirectoryHandle;
        handle = markRaw(toRaw(handle));
        const rawParent = markRaw(toRaw(dirHandle));

        if (!uiStore.showHiddenFiles && handle.name.startsWith('.')) continue;

        entries.push({
          name: handle.name,
          kind: handle.kind,
          handle,
          parentHandle: rawParent,
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
      .filter((e) => e.kind === 'file' && e.path?.startsWith(`${VIDEO_DIR_NAME}/`))
      .map((e) => e.path!);
    if (videoPaths.length > 0) {
      await proxyStore.checkExistingProxies(videoPaths);
    }

    return entries.sort(compareEntries);
  }

  function mergeEntries(prev: FsEntry[] | undefined, next: FsEntry[]): FsEntry[] {
    return mergeEntriesCore(prev, next, {
      isPathExpanded: (path) => uiStore.isFileTreePathExpanded(path),
    });
  }

  function findEntryByPath(path: string): FsEntry | null {
    return findEntryByPathCore(rootEntries.value, path);
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
        toast.add({
          color: 'red',
          title: 'Folder error',
          description: error.value || 'Failed to read folder',
        });
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

      // Automatically expand the media directories if present
      for (const entry of rootEntries.value) {
        if (
          entry.kind === 'directory' &&
          (entry.name === VIDEO_DIR_NAME ||
            entry.name === AUDIO_DIR_NAME ||
            entry.name === FILES_DIR_NAME ||
            entry.name === IMAGES_DIR_NAME)
        ) {
          if (!entry.expanded) await toggleDirectory(entry);
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        error.value = e?.message ?? 'Failed to open project folder';
        toast.add({
          color: 'red',
          title: 'Project error',
          description: error.value || 'Failed to open project folder',
        });
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
      const targetDirHandleRaw = targetDirHandle ? toRaw(targetDirHandle) : undefined;

      for (let file of Array.from(files)) {
        if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
          try {
            file = await convertSvgToPng(file, {
              maxWidth: projectStore.projectSettings.project.width,
              maxHeight: projectStore.projectSettings.project.height,
            });
          } catch (e) {
            console.warn('Failed to convert SVG to PNG', e);
            error.value = `Failed to import SVG: ${file.name}`;
            toast.add({
              color: 'red',
              title: 'SVG Import Error',
              description: error.value,
            });
            continue;
          }
        }

        let targetDir = targetDirHandleRaw;
        let finalRelativePathBase = targetDirPath || '';

        if (!targetDir) {
          let targetDirName = FILES_DIR_NAME;
          if (file.type.startsWith('audio/')) targetDirName = AUDIO_DIR_NAME;
          else if (file.type.startsWith('image/')) targetDirName = IMAGES_DIR_NAME;
          else if (file.type.startsWith('video/')) targetDirName = VIDEO_DIR_NAME;
          else if (file.name.endsWith('.otio')) {
            toast.add({
              color: 'neutral',
              title: t('videoEditor.fileManager.skipOtio.title', 'Project files skipped'),
              description: t(
                'videoEditor.fileManager.skipOtio.description',
                `${file.name} is a project file and cannot be imported this way. Use Create Timeline instead.`,
              ),
            });
            continue;
          }

          targetDir = await projectDir.getDirectoryHandle(targetDirName, { create: true });
          finalRelativePathBase = targetDirName;
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
          const projectRelativePath = finalRelativePathBase
            ? `${finalRelativePathBase}/${file.name}`
            : file.name;
          void mediaStore.getOrFetchMetadata(fileHandle, projectRelativePath);
        }
      }

      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to upload files';
      toast.add({
        color: 'red',
        title: 'Upload error',
        description: error.value || 'Failed to upload files',
      });
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
      toast.add({
        color: 'red',
        title: 'Folder error',
        description: error.value || 'Failed to create folder',
      });
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteEntry(target: FsEntry) {
    error.value = null;
    isLoading.value = true;
    try {
      const parent = target.parentHandle ? toRaw(target.parentHandle) : undefined;
      if (parent) {
        await parent.removeEntry(target.name, { recursive: true });
      }
      if (target.path && target.kind === 'file') {
        await proxyStore.deleteProxy(target.path);

        if (
          target.path.startsWith(`${VIDEO_DIR_NAME}/`) ||
          target.path.startsWith(`${SOURCES_DIR_NAME}/video/`)
        ) {
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
      toast.add({
        color: 'red',
        title: 'Delete error',
        description: error.value || 'Failed to delete',
      });
    } finally {
      isLoading.value = false;
    }
  }

  async function renameEntry(target: FsEntry, newName: string) {
    if (!target.parentHandle) return;

    error.value = null;
    isLoading.value = true;
    try {
      const parent = toRaw(target.parentHandle);

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
        if (typeof dirHandle.move === 'function') {
          await dirHandle.move(newName);
        } else {
          await renameDirectoryFallback({
            sourceDirHandle: target.handle as FileSystemDirectoryHandle,
            sourceName: target.name,
            parentDirHandle: parent,
            newName,
          });
        }
      }

      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to rename';
      toast.add({
        color: 'red',
        title: 'Rename error',
        description: error.value || 'Failed to rename',
      });
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
      const targetDirHandleRaw = toRaw(params.targetDirHandle);
      const sourceParentRaw = toRaw(params.source.parentHandle);

      await assertEntryDoesNotExist({
        targetDirHandle: targetDirHandleRaw,
        entryName: params.source.name,
        kind: params.source.kind,
      });

      if (params.source.kind === 'file') {
        await copyFileToDirectory({
          sourceHandle: toRaw(params.source.handle) as FileSystemFileHandle,
          fileName: params.source.name,
          targetDirHandle: targetDirHandleRaw,
        });
        await sourceParentRaw.removeEntry(params.source.name);

        const oldPath = sourcePath;
        const newPath = targetDirPath
          ? `${targetDirPath}/${params.source.name}`
          : params.source.name;

        delete mediaStore.mediaMetadata[oldPath];
        delete mediaStore.mediaMetadata[newPath];

        if (
          oldPath.startsWith(`${VIDEO_DIR_NAME}/`) ||
          oldPath.startsWith(`${SOURCES_DIR_NAME}/video/`)
        ) {
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
        const targetDir = await targetDirHandleRaw.getDirectoryHandle(params.source.name, {
          create: true,
        });
        await copyDirectoryRecursive({
          sourceDirHandle: toRaw(params.source.handle) as FileSystemDirectoryHandle,
          targetDirHandle: targetDir,
        });
        await sourceParentRaw.removeEntry(params.source.name, { recursive: true });

        mediaStore.resetMediaState();
        proxyStore.existingProxies.clear();
      }

      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to move';
      toast.add({
        color: 'red',
        title: 'Move error',
        description: error.value || 'Failed to move',
      });
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  async function createTimeline(): Promise<string | null> {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return null;

    error.value = null;
    isLoading.value = true;
    try {
      const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
        projectStore.currentProjectName,
      );
      const timelinesDir = await projectDir.getDirectoryHandle(TIMELINES_DIR_NAME, {
        create: true,
      });

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
      return `${TIMELINES_DIR_NAME}/${fileName}`;
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to create timeline';
      toast.add({
        color: 'red',
        title: 'Timeline error',
        description: error.value || 'Failed to create timeline',
      });
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  function getFileIcon(entry: FsEntry): string {
    if (entry.kind === 'directory') return 'i-heroicons-folder';
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'i-heroicons-film';
    if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'i-heroicons-musical-note';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext))
      return 'i-heroicons-photo';
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
