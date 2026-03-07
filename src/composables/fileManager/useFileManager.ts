import { ref, shallowRef, computed, toRaw, markRaw, watch, type Ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useFocusStore } from '~/stores/focus.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import {
  VIDEO_DIR_NAME,
  AUDIO_DIR_NAME,
  IMAGES_DIR_NAME,
  FILES_DIR_NAME,
  TIMELINES_DIR_NAME,
} from '~/utils/constants';
import { getMediaTypeFromFilename, getIconForMediaType } from '~/utils/media-types';
import { getClipThumbnailsHash, thumbnailGenerator } from '~/utils/thumbnail-generator';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { createProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import {
  clearVideoThumbnailsCommand,
  onVideoPathMovedCommand,
  removeProxyCommand,
} from '~/media-cache/application/proxyThumbnailCommands';
import { clearVectorImageRaster } from '~/media-cache/application/vectorImageCache';
import type { FsEntry } from '~/types/fs';
import { isMoveAllowed as isMoveAllowedCore } from '~/file-manager/core/rules';
import { findEntryByPath as findEntryByPathCore } from '~/file-manager/core/tree';
import { createFileManagerService } from '~/file-manager/application/fileManagerService';
import {
  createFolderCommand,
  createTimelineCommand,
  deleteEntryCommand,
  handleFilesCommand,
  moveEntryCommand,
  renameEntryCommand,
  resolveDefaultTargetDir,
} from '~/file-manager/application/fileManagerCommands';
import { createUiActionRunner } from './useUiActionRunner';

type FileTreeSortMode = 'name' | 'type';

export function isMoveAllowed(params: { sourcePath: string; targetDirPath: string }): boolean {
  return isMoveAllowedCore(params);
}

export interface FileManagerCreateDeps {
  t: ReturnType<typeof useI18n>['t'];
  toast: ReturnType<typeof useToast>;
  isApiSupported: Ref<boolean>;
  rootEntries: Ref<FsEntry[]>;
  sortMode: Ref<FileTreeSortMode>;
  showHiddenFiles: Ref<boolean>;
  isFileTreePathExpanded: (path: string) => boolean;
  setFileTreePathExpanded: (path: string, expanded: boolean) => void;
  getExpandedPaths: () => string[];
  getWorkspaceHandle: () => FileSystemDirectoryHandle | null;
  getProjectRootDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
  getProjectDirHandle: () => Promise<FileSystemDirectoryHandle | null>;
  getProjectName: () => string | null;
  getProjectId: () => string | null;
  getProjectSize: () => { width: number; height: number };
  onMediaImported: (params: {
    fileHandle: FileSystemFileHandle;
    projectRelativePath: string;
  }) => void;
  mediaCache: import('~/media-cache/application/proxyThumbnailService').ProxyThumbnailService;
  onEntryPathChanged?: (params: { oldPath: string; newPath: string }) => void | Promise<void>;
  onDirectoryMoved?: () => void | Promise<void>;
  onDirectoryLoaded?: () => void;
  mediaStore: ReturnType<typeof useMediaStore>;
}

export function createFileManager(deps: FileManagerCreateDeps) {
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const runWithUiFeedback = createUiActionRunner({ isLoading, error }, { toast: deps.toast });
  const timelineMediaUsageStore = useTimelineMediaUsageStore();

  const service = createFileManagerService({
    rootEntries: deps.rootEntries,
    sortMode: deps.sortMode,
    showHiddenFiles: () => deps.showHiddenFiles.value,
    hasPersistedFileTreeState: () => {
      const projectName = deps.getProjectName();
      if (!projectName) return false;
      const uiStore = useUiStore();
      return uiStore.hasPersistedFileTreeState(projectName);
    },
    isPathExpanded: (path) => deps.isFileTreePathExpanded(path),
    setPathExpanded: (path, expanded) => deps.setFileTreePathExpanded(path, expanded),
    getExpandedPaths: () => deps.getExpandedPaths(),
    sanitizeHandle: <T extends object>(handle: T) => markRaw(toRaw(handle)) as unknown as T,
    sanitizeParentHandle: (handle) => markRaw(toRaw(handle)),
    checkExistingProxies: (videoPaths) => deps.mediaCache.checkExistingProxies(videoPaths),
    onDirectoryLoaded: () => {
      deps.onDirectoryLoaded?.();
      const uiStore = useUiStore();
      uiStore.notifyFileManagerUpdate();
    },
    onError: (params: { title?: string; message: string; error?: unknown }) => {
      const description = params.error
        ? `${params.message}: ${String((params.error as any)?.message ?? params.error)}`
        : params.message;
      deps.toast.add({
        color: 'red',
        title: params.title ?? 'File manager error',
        description,
      });
    },
  });

  watch(
    () => deps.showHiddenFiles.value,
    () => {
      void loadProjectDirectory({ fullRefresh: true });
    },
  );

  function findEntryByPath(path: string): FsEntry | null {
    return service.findEntryByPath(path);
  }

  function mergeEntries(prev: FsEntry[] | undefined, next: FsEntry[]): FsEntry[] {
    return service.mergeEntries(prev, next);
  }

  async function toggleDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;
    await runWithUiFeedback({
      action: async () => {
        await service.toggleDirectory(entry);
      },
      defaultErrorMessage: 'Failed to read folder',
      toastTitle: 'Folder error',
      toastDescription: () => error.value || 'Failed to read folder',
      ignoreError: () => false,
    });
  }

  async function loadProjectDirectory(options?: { fullRefresh?: boolean }) {
    const projectDir = await deps.getProjectDirHandle();
    if (!projectDir) {
      deps.rootEntries.value = [];
      void timelineMediaUsageStore.refreshUsage();
      return;
    }

    const shouldFullRefresh = options?.fullRefresh ?? false;

    await runWithUiFeedback({
      action: async () => {
        await service.loadProjectDirectory(projectDir, {
          refreshExpandedChildren: shouldFullRefresh,
          expandPersistedDirectories: true,
          autoExpandMediaDirs: true,
        });
      },
      defaultErrorMessage: 'Failed to open project folder',
      toastTitle: 'Project error',
      toastDescription: () => error.value || 'Failed to open project folder',
      ignoreError: (e: unknown) => e instanceof Error && e.name === 'AbortError',
    });

    void timelineMediaUsageStore.refreshUsage();
  }

  async function handleFiles(
    files: FileList | File[],
    targetDirHandle?: FileSystemDirectoryHandle,
    targetDirPath?: string,
  ) {
    const projectName = deps.getProjectName();
    if (!projectName) return;
    const projectDir = await deps.getProjectDirHandle();
    if (!projectDir) return;

    await runWithUiFeedback({
      action: async () => {
        await handleFilesCommand(
          files,
          {
            targetDirHandle: targetDirHandle ? toRaw(targetDirHandle) : undefined,
            targetDirPath,
          },
          {
            getProjectDirHandle: async () => projectDir,
            getTargetDirHandle: async ({ projectDir: pd, file }) =>
              await resolveDefaultTargetDir({ projectDir: pd, file }),
            onSkipProjectFile: ({ file }) => {
              deps.toast.add({
                color: 'neutral',
                title: deps.t('videoEditor.fileManager.skipOtio.title', 'Project files skipped'),
                description: deps.t(
                  'videoEditor.fileManager.skipOtio.description',
                  `${file.name} is a project file and cannot be imported this way. Use Create Timeline instead.`,
                ),
              });
            },
            onMediaImported: ({ fileHandle, projectRelativePath }) => {
              deps.onMediaImported({
                fileHandle: fileHandle as FileSystemFileHandle,
                projectRelativePath,
              });
            },
          },
        );

        if (targetDirPath !== undefined) {
          await reloadDirectory(targetDirPath);
        } else {
          await loadProjectDirectory();
        }
      },
      defaultErrorMessage: 'Failed to upload files',
      toastTitle: 'Upload error',
      toastDescription: () => error.value || 'Failed to upload files',
    });
  }

  async function createFolder(
    name: string,
    targetEntry: FileSystemDirectoryHandle | null = null,
    parentPath: string = '',
  ) {
    const projectName = deps.getProjectName();
    if (!projectName) return;

    await runWithUiFeedback({
      action: async () => {
        const baseDir = targetEntry || (await deps.getProjectDirHandle());
        if (!baseDir) return;

        if (parentPath) {
          deps.setFileTreePathExpanded(parentPath, true);
        }

        await createFolderCommand({ name, baseDir });
        await reloadDirectory(parentPath);
      },
      defaultErrorMessage: 'Failed to create folder',
      toastTitle: 'Folder error',
      toastDescription: () => error.value || 'Failed to create folder',
    });
  }

  async function triggerMediaIntegrityCheck() {
    await timelineMediaUsageStore.refreshUsage();
    const usedPaths = Object.keys(timelineMediaUsageStore.mediaPathToTimelines);
    await deps.mediaStore.revalidateMissingMedia(usedPaths);
  }

  async function clearVectorCacheForPath(path: string) {
    const projectId = deps.getProjectId();
    const workspaceHandle = deps.getWorkspaceHandle();
    if (!projectId || !workspaceHandle) return;

    await clearVectorImageRaster({
      projectId,
      projectRelativePath: path,
      workspaceHandle,
    });
  }

  async function deleteEntry(target: FsEntry) {
    await runWithUiFeedback({
      action: async () => {
        await deleteEntryCommand(target, {
          removeEntry: async ({ parentHandle, name, recursive }) => {
            const parent = toRaw(parentHandle);
            await parent.removeEntry(name, { recursive });
          },
          onFileDeleted: async ({ path }) => {
            await removeProxyCommand({
              service: deps.mediaCache,
              projectRelativePath: path,
            });

            await clearVectorCacheForPath(path);

            if (path.startsWith(`${VIDEO_DIR_NAME}/`)) {
              const projectId = deps.getProjectId();
              if (projectId) {
                await clearVideoThumbnailsCommand({
                  service: deps.mediaCache,
                  projectId,
                  projectRelativePath: path,
                });
              }
            }

            if (path.startsWith(`${VIDEO_DIR_NAME}/`) || path.startsWith(`${AUDIO_DIR_NAME}/`)) {
              const projectId = deps.getProjectId();
              if (projectId) {
                await deps.mediaCache.clearWaveforms({
                  projectId,
                  projectRelativePath: path,
                });
              }
            }
          },
        });

        const parentPath = getParentPath(target.path);
        await reloadDirectory(parentPath);
        await triggerMediaIntegrityCheck();
      },
      defaultErrorMessage: 'Failed to delete',
      toastTitle: 'Delete error',
      toastDescription: () => error.value || 'Failed to delete',
    });
  }

  async function renameEntry(target: FsEntry, newName: string) {
    if (!target.parentHandle) return;

    const oldPath = target.path;
    const parentPath = oldPath ? oldPath.split('/').slice(0, -1).join('/') : '';
    const newPath = oldPath ? (parentPath ? `${parentPath}/${newName}` : newName) : '';

    await runWithUiFeedback({
      action: async () => {
        await renameEntryCommand(
          { target, newName },
          {
            ensureTargetNameDoesNotExist: async ({ parentHandle, kind, newName: nn }) => {
              const parent = toRaw(parentHandle);
              try {
                if (kind === 'file') {
                  await parent.getFileHandle(nn);
                } else {
                  await parent.getDirectoryHandle(nn);
                }
                throw new Error(`Target name already exists: ${nn}`);
              } catch (e: unknown) {
                if (e instanceof Error && e.name !== 'NotFoundError') throw e;
              }
            },
            removeEntry: async ({ parentHandle, name, recursive }) => {
              const parent = toRaw(parentHandle);
              await parent.removeEntry(name, { recursive });
            },
          },
        );

        if (oldPath && newPath) {
          await deps.onEntryPathChanged?.({ oldPath, newPath });
        }

        const parentPathForRename = getParentPath(target.path);
        await reloadDirectory(parentPathForRename);
        await triggerMediaIntegrityCheck();
      },
      defaultErrorMessage: 'Failed to rename',
      toastTitle: 'Rename error',
      toastDescription: () => error.value || 'Failed to rename',
    });
  }

  async function moveEntry(params: {
    source: FsEntry;
    targetDirHandle: FileSystemDirectoryHandle;
    targetDirPath: string;
  }) {
    const projectName = deps.getProjectName();
    if (!projectName) return;
    if (!params.source.parentHandle) return;

    const sourcePath = params.source.path ?? '';
    const targetDirPath = params.targetDirPath ?? '';
    if (!sourcePath) return;

    const sourceParentPath = sourcePath.split('/').slice(0, -1).join('/');
    if (sourceParentPath === targetDirPath) return;

    if (!isMoveAllowed({ sourcePath, targetDirPath })) return;

    await runWithUiFeedback({
      action: async () => {
        await moveEntryCommand(
          {
            source: {
              ...params.source,
              handle: toRaw(params.source.handle) as any,
              parentHandle: params.source.parentHandle
                ? toRaw(params.source.parentHandle)
                : undefined,
            },
            targetDirHandle: toRaw(params.targetDirHandle),
            targetDirPath,
          },
          {
            removeEntry: async ({ parentHandle, name, recursive }) => {
              const parent = toRaw(parentHandle);
              await parent.removeEntry(name, { recursive });
            },
            onFileMoved: async ({ oldPath, newPath }) => {
              await deps.onEntryPathChanged?.({ oldPath, newPath });

              if (oldPath.startsWith(`${VIDEO_DIR_NAME}/`)) {
                const projectId = deps.getProjectId();
                if (projectId) {
                  await onVideoPathMovedCommand({
                    service: deps.mediaCache,
                    projectId,
                    oldPath,
                    newPath,
                  });
                } else {
                  await removeProxyCommand({
                    service: deps.mediaCache,
                    projectRelativePath: oldPath,
                  });
                  deps.mediaCache.clearExistingProxies();
                  await deps.mediaCache.checkExistingProxies([newPath]);
                }
              }
            },
            onDirectoryMoved: async () => {
              await deps.onDirectoryMoved?.();
              deps.mediaCache.clearExistingProxies();
            },
          },
        );

        const sourceParentPath = getParentPath(sourcePath);

        if (targetDirPath) {
          deps.setFileTreePathExpanded(targetDirPath, true);
        }

        await reloadDirectory(sourceParentPath);
        await reloadDirectory(targetDirPath);
        await triggerMediaIntegrityCheck();
      },
      defaultErrorMessage: 'Failed to move',
      toastTitle: 'Move error',
      toastDescription: () => error.value || 'Failed to move',
    });
  }

  async function createTimeline(): Promise<string | null> {
    const projectDir = await deps.getProjectDirHandle();
    if (!projectDir) return null;

    return await runWithUiFeedback({
      action: async () => {
        const createdPath = await createTimelineCommand({
          projectDir,
          timelinesDirName: TIMELINES_DIR_NAME,
        });
        await reloadDirectory(TIMELINES_DIR_NAME);
        return createdPath;
      },
      defaultErrorMessage: 'Failed to create timeline',
      toastTitle: 'Timeline error',
      toastDescription: () => error.value || 'Failed to create timeline',
    });
  }

  function getFileIcon(entry: FsEntry): string {
    if (entry.kind === 'directory') return 'i-heroicons-folder';
    if (entry.name.toLowerCase().endsWith('.otio')) return 'i-heroicons-rectangle-stack';
    const type = getMediaTypeFromFilename(entry.name);
    return getIconForMediaType(type);
  }

  function getParentPath(path?: string): string {
    if (!path) return '';
    const parts = path.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
  }

  async function reloadDirectory(path: string) {
    const projectDir = await deps.getProjectDirHandle();
    if (projectDir) {
      await service.reloadDirectory(path, projectDir);
      deps.onDirectoryLoaded?.();
    }
  }

  return {
    rootEntries: deps.rootEntries,
    isLoading,
    error,
    isApiSupported: deps.isApiSupported,
    mediaCache: deps.mediaCache,
    getProjectRootDirHandle: deps.getProjectRootDirHandle,
    sortMode: deps.sortMode,
    setSortMode: (v: FileTreeSortMode) => {
      deps.sortMode.value = v;
    },
    loadProjectDirectory,
    toggleDirectory,
    handleFiles,
    createFolder,
    deleteEntry,
    renameEntry,
    findEntryByPath,
    mergeEntries,
    moveEntry,
    createTimeline,
    getFileIcon,
    readDirectory: service.readDirectory,
    reloadDirectory,
  };
}

const sharedRootEntries = shallowRef<FsEntry[]>([]);
const sharedSortMode = ref<FileTreeSortMode>('name');

export function useFileManager() {
  const { t } = useI18n();
  const toast = useToast();
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const mediaStore = useMediaStore();
  const proxyStore = useProxyStore();
  const selectionStore = useSelectionStore();
  const focusStore = useFocusStore();

  const isApiSupported = computed(() => workspaceStore.isApiSupported);
  const showHiddenFiles = computed(() => uiStore.showHiddenFiles);

  function updateSelectionPath(params: { oldPath: string; newPath: string }) {
    if (uiStore.selectedFsEntry?.path === params.oldPath) {
      uiStore.selectedFsEntry = {
        ...uiStore.selectedFsEntry,
        path: params.newPath,
        name: params.newPath.split('/').pop() ?? uiStore.selectedFsEntry.name,
      };
      focusStore.setTempFocus('left');
    }

    if (
      selectionStore.selectedEntity &&
      selectionStore.selectedEntity.source === 'fileManager' &&
      'path' in selectionStore.selectedEntity &&
      selectionStore.selectedEntity.path === params.oldPath
    ) {
      const updatedEntry = findEntryByPathCore(sharedRootEntries.value, params.newPath);
      if (updatedEntry) {
        selectionStore.selectFsEntry(updatedEntry);
      }
    }
  }

  async function clearVectorCacheForPath(path: string) {
    const projectId = projectStore.currentProjectId;
    const workspaceHandle = workspaceStore.workspaceHandle;
    if (!projectId || !workspaceHandle) return;

    await clearVectorImageRaster({
      projectId,
      projectRelativePath: path,
      workspaceHandle,
    });
  }

  const api = createFileManager({
    t,
    toast,
    isApiSupported,
    rootEntries: sharedRootEntries,
    sortMode: sharedSortMode,
    showHiddenFiles,
    mediaStore,
    isFileTreePathExpanded: (path) => uiStore.isFileTreePathExpanded(path),
    setFileTreePathExpanded: (path, expanded) => {
      const projectName = projectStore.currentProjectName;
      if (!projectName) return;
      uiStore.setFileTreePathExpanded(projectName, path, expanded);
    },
    getExpandedPaths: () => Object.keys(uiStore.fileTreeExpandedPaths),
    getWorkspaceHandle: () => workspaceStore.workspaceHandle,
    getProjectRootDirHandle: async () => {
      if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return null;
      return await workspaceStore.projectsHandle.getDirectoryHandle(
        projectStore.currentProjectName,
      );
    },
    getProjectDirHandle: async () => {
      if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return null;
      return await workspaceStore.projectsHandle.getDirectoryHandle(
        projectStore.currentProjectName,
      );
    },
    getProjectName: () => projectStore.currentProjectName,
    getProjectId: () => projectStore.currentProjectId,
    getProjectSize: () => ({
      width: projectStore.projectSettings.project.width,
      height: projectStore.projectSettings.project.height,
    }),
    onMediaImported: ({ fileHandle, projectRelativePath }) => {
      void mediaStore.getOrFetchMetadata(fileHandle, projectRelativePath);
    },
    mediaCache: createProxyThumbnailService({
      checkExistingProxies: async (paths) => await proxyStore.checkExistingProxies(paths),
      hasProxy: (path) => proxyStore.existingProxies.has(path),
      ensureProxy: async ({ fileHandle, projectRelativePath }) =>
        await proxyStore.generateProxy(fileHandle, projectRelativePath),
      cancelProxy: async (projectRelativePath) =>
        await proxyStore.cancelProxyGeneration(projectRelativePath),
      removeProxy: async (projectRelativePath) => await proxyStore.deleteProxy(projectRelativePath),
      clearExistingProxies: () => proxyStore.existingProxies.clear(),
      clearVideoThumbnails: async ({ projectId, projectRelativePath }) => {
        await thumbnailGenerator.clearThumbnails({
          projectId,
          hash: getClipThumbnailsHash({ projectId, projectRelativePath }),
        });
        await fileThumbnailGenerator.clearThumbnail({
          projectId,
          projectRelativePath,
        });
      },
      clearWaveforms: async ({ projectId, projectRelativePath }) => {
        await mediaStore.removeMediaCache(projectRelativePath);
      },
    }),
    onEntryPathChanged: async ({ oldPath, newPath }) => {
      await mediaStore.removeMediaCache(oldPath);
      await mediaStore.removeMediaCache(newPath);
      await clearVectorCacheForPath(oldPath);
      await clearVectorCacheForPath(newPath);
      updateSelectionPath({ oldPath, newPath });
    },
    onDirectoryMoved: async () => {
      mediaStore.resetMediaState();
    },
    onDirectoryLoaded: () => {
      uiStore.notifyFileManagerUpdate();
    },
  });

  return api;
}
