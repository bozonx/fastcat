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

  async function runWithUiFeedback<T>(params: {
    action: () => Promise<T>;
    defaultErrorMessage: string;
    toastTitle: string;
    toastDescription?: () => string;
    ignoreError?: (e: unknown) => boolean;
    rethrow?: boolean;
  }): Promise<T | null> {
    error.value = null;
    isLoading.value = true;
    try {
      return await params.action();
    } catch (e: any) {
      if (params.ignoreError?.(e)) {
        return null;
      }

      error.value = e?.message ?? params.defaultErrorMessage;
      toast.add({
        color: 'red',
        title: params.toastTitle,
        description: params.toastDescription?.() ?? (error.value || params.defaultErrorMessage),
      });

      if (params.rethrow) throw e;
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  const service = createFileManagerService({
    rootEntries,
    sortMode,
    showHiddenFiles: () => uiStore.showHiddenFiles,
    isPathExpanded: (path) => uiStore.isFileTreePathExpanded(path),
    setPathExpanded: (path, expanded) => {
      const projectName = projectStore.currentProjectName;
      if (!projectName) return;
      uiStore.setFileTreePathExpanded(projectName, path, expanded);
    },
    getExpandedPaths: () => Object.keys(uiStore.fileTreeExpandedPaths),
    sanitizeHandle: <T extends object>(handle: T) => markRaw(toRaw(handle)) as unknown as T,
    sanitizeParentHandle: (handle) => markRaw(toRaw(handle)),
    checkExistingProxies: (videoPaths) => proxyStore.checkExistingProxies(videoPaths),
  });

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

  function findEntryByPath(path: string): FsEntry | null {
    return service.findEntryByPath(path);
  }

  function mergeEntries(prev: FsEntry[] | undefined, next: FsEntry[]): FsEntry[] {
    return service.mergeEntries(prev, next);
  }

  async function toggleDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;

    const prevExpanded = Boolean(entry.expanded);
    await runWithUiFeedback({
      action: async () => {
        await service.toggleDirectory(entry);
      },
      defaultErrorMessage: 'Failed to read folder',
      toastTitle: 'Folder error',
      toastDescription: () => error.value || 'Failed to read folder',
      ignoreError: () => false,
    });

    if (error.value) {
      entry.expanded = prevExpanded;
      const projectName = projectStore.currentProjectName;
      if (projectName && entry.path) {
        uiStore.setFileTreePathExpanded(projectName, entry.path, prevExpanded);
      }
    }
  }

  async function loadProjectDirectory() {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) {
      rootEntries.value = [];
      return;
    }

    await runWithUiFeedback({
      action: async () => {
        const projectDir = await workspaceStore.projectsHandle!.getDirectoryHandle(
          projectStore.currentProjectName!,
        );
        await service.loadProjectDirectory(projectDir);
      },
      defaultErrorMessage: 'Failed to open project folder',
      toastTitle: 'Project error',
      toastDescription: () => error.value || 'Failed to open project folder',
      ignoreError: (e: any) => e?.name === 'AbortError',
    });
  }

  async function handleFiles(
    files: FileList | File[],
    targetDirHandle?: FileSystemDirectoryHandle,
    targetDirPath?: string,
  ) {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    await runWithUiFeedback({
      action: async () => {
        await handleFilesCommand(
          files,
          {
            targetDirHandle: targetDirHandle ? toRaw(targetDirHandle) : undefined,
            targetDirPath,
          },
          {
            getProjectDirHandle: async () =>
              await workspaceStore.projectsHandle!.getDirectoryHandle(
                projectStore.currentProjectName!,
              ),
            getTargetDirHandle: async ({ projectDir, file }) =>
              await resolveDefaultTargetDir({ projectDir, file }),
            convertSvgToPng: async (file) =>
              await convertSvgToPng(file, {
                maxWidth: projectStore.projectSettings.project.width,
                maxHeight: projectStore.projectSettings.project.height,
              }),
            onSvgConvertError: ({ file, error: e }) => {
              console.warn('Failed to convert SVG to PNG', e);
              error.value = `Failed to import SVG: ${file.name}`;
              toast.add({
                color: 'red',
                title: 'SVG Import Error',
                description: error.value,
              });
            },
            onSkipProjectFile: ({ file }) => {
              toast.add({
                color: 'neutral',
                title: t('videoEditor.fileManager.skipOtio.title', 'Project files skipped'),
                description: t(
                  'videoEditor.fileManager.skipOtio.description',
                  `${file.name} is a project file and cannot be imported this way. Use Create Timeline instead.`,
                ),
              });
            },
            onMediaImported: ({ fileHandle, projectRelativePath }) => {
              void mediaStore.getOrFetchMetadata(fileHandle, projectRelativePath);
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
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    await runWithUiFeedback({
      action: async () => {
        const baseDir =
          targetEntry ||
          (await workspaceStore.projectsHandle!.getDirectoryHandle(
            projectStore.currentProjectName!,
          ));
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
            await proxyStore.deleteProxy(path);

            if (
              path.startsWith(`${VIDEO_DIR_NAME}/`) ||
              path.startsWith(`${SOURCES_DIR_NAME}/video/`)
            ) {
              if (projectStore.currentProjectId) {
                await thumbnailGenerator.clearThumbnails({
                  projectId: projectStore.currentProjectId,
                  hash: getClipThumbnailsHash({
                    projectId: projectStore.currentProjectId,
                    projectRelativePath: path,
                  }),
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
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;
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
            },
            onDirectoryMoved: async () => {
              mediaStore.resetMediaState();
              proxyStore.existingProxies.clear();
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
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return null;

    return await runWithUiFeedback({
      action: async () => {
        const projectDir = await workspaceStore.projectsHandle!.getDirectoryHandle(
          projectStore.currentProjectName!,
        );
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
