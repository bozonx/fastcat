import { ref, computed, toRaw, markRaw, watch, type Ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useFocusStore } from '~/stores/focus.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { convertSvgToPng } from '~/utils/svg';
import {
  VIDEO_DIR_NAME,
  AUDIO_DIR_NAME,
  IMAGES_DIR_NAME,
  FILES_DIR_NAME,
  TIMELINES_DIR_NAME,
} from '~/utils/constants';
import { getClipThumbnailsHash, thumbnailGenerator } from '~/utils/thumbnail-generator';
import { createProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import {
  clearVideoThumbnailsCommand,
  onVideoPathMovedCommand,
  removeProxyCommand,
} from '~/media-cache/application/proxyThumbnailCommands';
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

type FileTreeSortMode = 'name' | 'modified';

export function isMoveAllowed(params: { sourcePath: string; targetDirPath: string }): boolean {
  return isMoveAllowedCore(params);
}

interface UiActionRunnerState {
  isLoading: Ref<boolean>;
  error: Ref<string | null>;
}

interface UiActionRunnerDeps {
  toast: ReturnType<typeof useToast>;
}

function createUiActionRunner(state: UiActionRunnerState, deps: UiActionRunnerDeps) {
  return async function runWithUiFeedback<T>(params: {
    action: () => Promise<T>;
    defaultErrorMessage: string;
    toastTitle: string;
    toastDescription?: () => string;
    ignoreError?: (e: unknown) => boolean;
    rethrow?: boolean;
  }): Promise<T | null> {
    state.error.value = null;
    state.isLoading.value = true;
    try {
      return await params.action();
    } catch (e: any) {
      if (params.ignoreError?.(e)) {
        return null;
      }

      state.error.value = e?.message ?? params.defaultErrorMessage;
      deps.toast.add({
        color: 'red',
        title: params.toastTitle,
        description:
          params.toastDescription?.() ?? (state.error.value || params.defaultErrorMessage),
      });

      if (params.rethrow) throw e;
      return null;
    } finally {
      state.isLoading.value = false;
    }
  };
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
      void loadProjectDirectory();
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

  async function loadProjectDirectory() {
    const projectDir = await deps.getProjectDirHandle();
    if (!projectDir) {
      deps.rootEntries.value = [];
      void timelineMediaUsageStore.refreshUsage();
      return;
    }

    await runWithUiFeedback({
      action: async () => {
        await service.loadProjectDirectory(projectDir);
      },
      defaultErrorMessage: 'Failed to open project folder',
      toastTitle: 'Project error',
      toastDescription: () => error.value || 'Failed to open project folder',
      ignoreError: (e: any) => e?.name === 'AbortError',
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
            convertSvgToPng: async (file) =>
              await convertSvgToPng(file, {
                maxWidth: deps.getProjectSize().width,
                maxHeight: deps.getProjectSize().height,
              }),
            onSvgConvertError: ({ file, error: e }) => {
              console.warn('Failed to convert SVG to PNG', e);
              error.value = `Failed to import SVG: ${file.name}`;
              deps.toast.add({
                color: 'red',
                title: 'SVG Import Error',
                description: error.value,
              });
            },
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

        await loadProjectDirectory();
      },
      defaultErrorMessage: 'Failed to upload files',
      toastTitle: 'Upload error',
      toastDescription: () => error.value || 'Failed to upload files',
    });
  }

  async function createFolder(name: string, targetEntry: FileSystemDirectoryHandle | null = null) {
    const projectName = deps.getProjectName();
    if (!projectName) return;

    await runWithUiFeedback({
      action: async () => {
        const baseDir = targetEntry || (await deps.getProjectDirHandle());
        if (!baseDir) return;
        await createFolderCommand({ name, baseDir });
        await loadProjectDirectory();
      },
      defaultErrorMessage: 'Failed to create folder',
      toastTitle: 'Folder error',
      toastDescription: () => error.value || 'Failed to create folder',
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
          },
        });

        await loadProjectDirectory();
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
              } catch (e: any) {
                if (e?.name !== 'NotFoundError') throw e;
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

        await loadProjectDirectory();
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

        await loadProjectDirectory();
      },
      defaultErrorMessage: 'Failed to move',
      toastTitle: 'Move error',
      toastDescription: () => error.value || 'Failed to move',
      rethrow: true,
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
        await loadProjectDirectory();
        return createdPath;
      },
      defaultErrorMessage: 'Failed to create timeline',
      toastTitle: 'Timeline error',
      toastDescription: () => error.value || 'Failed to create timeline',
    });
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
  };
}

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

  const rootEntries = ref<FsEntry[]>([]);
  const sortMode = ref<FileTreeSortMode>('name');

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
      selectionStore.selectedEntity?.source === 'fileManager' &&
      selectionStore.selectedEntity.path === params.oldPath
    ) {
      const updatedEntry = findEntryByPathCore(rootEntries.value, params.newPath);
      if (updatedEntry) {
        selectionStore.selectFsEntry(updatedEntry);
      }
    }
  }

  const api = createFileManager({
    t,
    toast,
    isApiSupported,
    rootEntries,
    sortMode,
    showHiddenFiles,
    isFileTreePathExpanded: (path) => uiStore.isFileTreePathExpanded(path),
    setFileTreePathExpanded: (path, expanded) => {
      const projectName = projectStore.currentProjectName;
      if (!projectName) return;
      uiStore.setFileTreePathExpanded(projectName, path, expanded);
    },
    getExpandedPaths: () => Object.keys(uiStore.fileTreeExpandedPaths),
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
      },
    }),
    onEntryPathChanged: async ({ oldPath, newPath }) => {
      delete mediaStore.mediaMetadata[oldPath];
      delete mediaStore.mediaMetadata[newPath];
      updateSelectionPath({ oldPath, newPath });
    },
    onDirectoryMoved: async () => {
      mediaStore.resetMediaState();
    },
  });

  return api;
}
