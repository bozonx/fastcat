import { ref, shallowRef, computed, type Ref, inject, type InjectionKey } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useMediaStore } from '~/stores/media.store';
import { useI18n } from 'vue-i18n';
import { useProxyStore } from '~/stores/proxy.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useHistoryStore } from '~/stores/history.store';
import { isClipItem, isSourceClipItem } from '~/timeline/types';
import { VIDEO_DIR_NAME, AUDIO_DIR_NAME } from '~/utils/constants';
import { getClipThumbnailsHash, thumbnailGenerator } from '~/utils/thumbnail-generator';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { createProxyThumbnailService } from '~/media-cache/application/proxyThumbnailService';
import { onVideoPathMovedCommand } from '~/media-cache/application/proxyThumbnailCommands';
import { clearVectorImageRasterVfs } from '~/media-cache/application/vectorImageCache';
import { normalizeMediaCachePath } from '~/utils/path';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { createFileManagerService } from '~/file-manager/application/fileManagerService';
import { resolveDefaultTargetDir } from '~/file-manager/application/fileManagerCommands';
import { useVfs } from '~/composables/useVfs';
import { createUiActionRunner } from './useUiActionRunner';
import { useFileManagerMoveSync } from './useFileManagerMoveSync';
import { isMoveAllowed, isCopyAllowed, createFileManagerCrud } from './useFileManagerCrud';
import { createFileManagerDirectory } from './useFileManagerDirectory';
import { createFileManagerUpload } from './useFileManagerUpload';
import { createFileManagerCreate } from './useFileManagerCreate';
import { createFileManagerCache } from './useFileManagerCache';
import { createFileManagerHistory } from './useFileManagerHistory';
import { getFileIcon, getParentPath } from './useFileManagerHelpers';
import type {
  FileManagerCreateDeps,
  FileManagerContext,
  FileTreeSortMode,
} from './fileManagerContext';

export { isMoveAllowed, isCopyAllowed };
export type { FileManagerCreateDeps, FileTreeSortMode };

export function createFileManager(deps: FileManagerCreateDeps) {
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const runWithUiFeedback = createUiActionRunner({ isLoading, error }, { toast: deps.toast });

  const service = createFileManagerService({
    rootEntries: deps.rootEntries,
    sortMode: deps.sortMode,
    showHiddenFiles: () => deps.showHiddenFiles.value,
    vfs: deps.vfs,
    hasPersistedFileTreeState: deps.hasPersistedFileTreeState,
    isPathExpanded: (path) => deps.isFileTreePathExpanded(path),
    setPathExpanded: (path, expanded) => deps.setFileTreePathExpanded(path, expanded),
    getExpandedPaths: () => deps.getExpandedPaths(),
    checkExistingProxies: (videoPaths) => deps.mediaCache.checkExistingProxies(videoPaths),
    onDirectoryLoaded: () => {
      deps.onDirectoryLoaded?.();
    },
    onDirectoryMoved: (params) => deps.onDirectoryMoved?.(params),
    onDirectoryCopied: (params) => deps.onDirectoryCopied?.(params),
    onError: (params) => {
      const description = params.error
        ? `${params.message}: ${String((params.error as Error)?.message ?? params.error)}`
        : params.message;
      deps.toast.add({
        color: 'error',
        title: params.title ?? 'File manager error',
        description,
      });
    },
  });

  function notifyFileManagerUpdate(): void {
    deps.notifyFileManagerUpdate?.();
  }

  const ctx: FileManagerContext = {
    deps,
    service,
    runWithUiFeedback,
    notifyFileManagerUpdate,
    isRestoringHistory: false,
    reloadDirectory: async () => {},
    loadProjectDirectory: async () => {},
    triggerMediaIntegrityCheck: async () => {},
    clearVectorCacheForPath: async () => {},
    clearVectorCacheForDirectory: async () => {},
    resolveEntryByPath: async () => null,
    getParentPath,
  };

  const directory = createFileManagerDirectory(ctx);
  const cache = createFileManagerCache(ctx);

  ctx.resolveEntryByPath = directory.resolveEntryByPath;
  ctx.reloadDirectory = directory.reloadDirectory;
  ctx.loadProjectDirectory = directory.loadProjectDirectory;
  ctx.triggerMediaIntegrityCheck = cache.triggerMediaIntegrityCheck;
  ctx.clearVectorCacheForPath = cache.clearVectorCacheForPath;
  ctx.clearVectorCacheForDirectory = cache.clearVectorCacheForDirectory;

  const upload = createFileManagerUpload(ctx);
  const crud = createFileManagerCrud(ctx);
  const create = createFileManagerCreate(ctx);
  const history = createFileManagerHistory(ctx, { ...directory, ...crud });

  deps.historyStore.registerCommandScope('fileManager');

  return {
    rootEntries: deps.rootEntries,
    isLoading,
    error,
    isApiSupported: deps.isApiSupported,
    mediaCache: deps.mediaCache,
    sortMode: deps.sortMode,
    setSortMode: (v: FileTreeSortMode) => {
      deps.sortMode.value = v;
    },
    loadProjectDirectory: directory.loadProjectDirectory,
    toggleDirectory: directory.toggleDirectory,
    ensureDirectoryExpanded: directory.ensureDirectoryExpanded,
    handleFiles: upload.handleFiles,
    createFolder: crud.createFolder,
    deleteEntry: crud.deleteEntry,
    renameEntry: crud.renameEntry,
    findEntryByPath: directory.findEntryByPath,
    resolveEntryByPath: directory.resolveEntryByPath,
    mergeEntries: directory.mergeEntries,
    moveEntry: crud.moveEntry,
    copyEntry: crud.copyEntry,
    createTimeline: create.createTimeline,
    createMarkdown: create.createMarkdown,
    getFileIcon,
    readDirectory: service.readDirectory,
    vfs: deps.vfs,
    reloadDirectory: directory.reloadDirectory,
    setFileTreePathExpanded: deps.setFileTreePathExpanded,
    resolveDefaultTargetDir: (params: { file: File } | { name: string }) =>
      resolveDefaultTargetDir(params),
    runWithUiFeedback,
    clearVectorCacheForDirectory: cache.clearVectorCacheForDirectory,
    restoreHistory: history.restoreHistory,
  };
}

export type FileManager = ReturnType<typeof createFileManager>;

export const FILE_MANAGER_INJECTION_KEY: InjectionKey<FileManager> = Symbol('FileManager');

/**
 * Scans timeline clips whose source path matches `matchFn` and applies
 * `pathTransform` to update their source path via batchApplyTimeline.
 * Replaces duplicated inline scanning in onEntryPathChanged and onDirectoryMoved.
 */
function updateTimelineClipPaths(
  timelineStore: ReturnType<typeof useTimelineStore>,
  matchFn: (clipPath: string) => boolean,
  pathTransform: (clipPath: string) => string,
): void {
  if (!timelineStore.timelineDoc) return;

  const cmds: {
    type: 'update_clip_properties';
    trackId: string;
    itemId: string;
    properties: { source: { path: string } };
  }[] = [];

  for (const track of timelineStore.timelineDoc.tracks) {
    for (const item of track.items) {
      if (!isClipItem(item)) continue;
      if (!isSourceClipItem(item)) continue;
      const clipPath = item.source?.path;
      if (!clipPath || !matchFn(clipPath)) continue;
      cmds.push({
        type: 'update_clip_properties',
        trackId: track.id,
        itemId: item.id,
        properties: {
          source: { ...item.source, path: pathTransform(clipPath) },
        },
      });
    }
  }

  if (cmds.length > 0) {
    timelineStore.batchApplyTimeline(cmds, { skipHistory: true });
  }
}

export function useFileManager(options?: {
  rootEntries?: Ref<FsEntry[]>;
  sortMode?: Ref<FileTreeSortMode>;
  vfs?: IFileSystemAdapter;
  shouldRecordFileManagerHistory?: () => boolean;
}) {
  const injected = inject(FILE_MANAGER_INJECTION_KEY, null);
  if (injected && !options?.vfs && !options?.rootEntries) {
    return injected;
  }

  const { t } = useI18n();
  const toast = useToast();
  const defaultVfs = useVfs();
  const vfs = options?.vfs || defaultVfs;
  const rootEntries = options?.rootEntries ?? shallowRef<FsEntry[]>([]);
  const sortMode = options?.sortMode ?? ref<FileTreeSortMode>('name');

  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const mediaStore = useMediaStore();
  const proxyStore = useProxyStore();
  const timelineStore = useTimelineStore();
  const historyStore = useHistoryStore();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();

  const isApiSupported = computed(() => workspaceStore.isApiSupported);
  const fileManagerStore = useFileManagerStore();
  const showHiddenFiles = computed(() => fileManagerStore.showHiddenFiles);

  const { updateSelectionPath, updateSelectionForDirectoryMove, syncTimelinePathsOnMove } =
    useFileManagerMoveSync(rootEntries);

  async function clearVectorCacheForPath(path: string) {
    const projectId = projectStore.currentProjectId;
    if (!projectId) return;
    await clearVectorImageRasterVfs({
      vfs,
      projectId,
      projectRelativePath: path,
    });
  }

  const mediaCache = createProxyThumbnailService({
    checkExistingProxies: async (paths) => await proxyStore.checkExistingProxies(paths),
    hasProxy: (path) => proxyStore.existingProxies.has(normalizeMediaCachePath(path)),
    ensureProxy: async ({ file, projectRelativePath }) =>
      await proxyStore.generateProxy(file, projectRelativePath),
    ensureProxyBatch: async (params) => await proxyStore.generateProxiesBatch(params.entries),
    cancelProxy: async (projectRelativePath) =>
      await proxyStore.cancelProxyGeneration(projectRelativePath),
    removeProxy: async (projectRelativePath) => await proxyStore.deleteProxy(projectRelativePath),
    removeProxyBatch: async (params) =>
      await proxyStore.deleteProxiesBatch(params.projectRelativePaths),
    renameProxy: async (params) => await proxyStore.renameProxy(params),
    renameProxyDir: async (params) => await proxyStore.renameProxyDir(params),
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
    clearWaveforms: async ({ projectRelativePath }) => {
      await mediaStore.removeMediaCache(projectRelativePath);
    },
  });

  return createFileManager({
    t,
    toast,
    vfs,
    isApiSupported,
    rootEntries,
    sortMode,
    showHiddenFiles,
    isFileTreePathExpanded: (path) => uiStore.isFileTreePathExpanded(path),
    setFileTreePathExpanded: (path, expanded) => {
      uiStore.setFileTreePathExpanded(path, expanded);
    },
    getExpandedPaths: () => Object.keys(uiStore.fileTreeExpandedPaths),
    hasPersistedFileTreeState: () => {
      const projectName = projectStore.currentProjectName;
      if (!projectName) return false;
      return uiStore.hasPersistedFileTreeState();
    },
    getWorkspaceHandle: () => workspaceStore.workspaceHandle,
    getProjectName: () => projectStore.currentProjectName,
    getProjectId: () => projectStore.currentProjectId,
    getProjectSize: () => ({
      width: timelineStore.timelineFormat.width,
      height: timelineStore.timelineFormat.height,
    }),
    getProjectSettings: () => projectStore.projectSettings,
    onMediaImported: ({ projectRelativePath }) => {
      void mediaStore.getOrFetchMetadataByPath(projectRelativePath);
    },
    onFileDeleted: async ({ path }) => {
      if (!path.toLowerCase().endsWith('.otio')) return;
      const { useProjectTabsStore } = await import('~/stores/project-tabs.store');
      if (projectStore.currentTimelinePath === path) {
        await projectStore.closeTimelineFile(path);
      }
      useProjectTabsStore().removeFileTabByPath(path);
    },
    mediaCache,
    mediaStore,
    historyStore,
    onEntryPathChanged: async ({ oldPath, newPath }) => {
      await mediaStore.removeMediaCache(oldPath);
      await mediaStore.removeMediaCache(newPath);
      await clearVectorCacheForPath(oldPath);
      await clearVectorCacheForPath(newPath);
      updateSelectionPath({ oldPath, newPath });
      await syncTimelinePathsOnMove({ oldPath, newPath });

      updateTimelineClipPaths(
        timelineStore,
        (clipPath) => clipPath === oldPath,
        () => newPath,
      );

      if (oldPath.startsWith(`${VIDEO_DIR_NAME}/`)) {
        const projectId = projectStore.currentProjectId;
        if (projectId) {
          await onVideoPathMovedCommand({
            service: mediaCache,
            projectId,
            oldPath,
            newPath,
          });
        }
      } else if (oldPath.startsWith(`${AUDIO_DIR_NAME}/`)) {
        const projectId = projectStore.currentProjectId;
        if (projectId) {
          await mediaCache.clearWaveforms({
            projectId,
            projectRelativePath: oldPath,
          });
        }
      }
    },
    onDirectoryMoved: async ({ oldPath, newPath }) => {
      await mediaStore.removeMediaCacheForDirectory(oldPath);
      await clearVectorCacheForPath(oldPath);
      await clearVectorCacheForPath(newPath);
      updateSelectionForDirectoryMove({ oldPath, newPath });
      await syncTimelinePathsOnMove({ oldPath, newPath });

      updateTimelineClipPaths(
        timelineStore,
        (clipPath) => clipPath.startsWith(`${oldPath}/`),
        (clipPath) => `${newPath}${clipPath.slice(oldPath.length)}`,
      );

      if (oldPath && newPath) {
        await mediaCache.renameProxyDir({ oldPath, newPath });
      } else {
        mediaCache.clearExistingProxies();
      }
    },
    onDirectoryCopied: async () => {
      // No need to clear cache for existing files. New copied files don't have cache yet.
    },
    onDirectoryLoaded: () => {
      // Default no-op; callers may override via injection if needed.
    },
    notifyFileManagerUpdate: () => uiStore.notifyFileManagerUpdate(),
    timelineMediaUsageStore,
    shouldRecordFileManagerHistory: options?.shouldRecordFileManagerHistory ?? (() => true),
    hideCommonRoot: !workspaceStore.inDevelopmentFeaturesEnabled,
  });
}
