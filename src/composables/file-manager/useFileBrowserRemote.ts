import { ref, computed, watch, inject } from 'vue';
import type { Ref } from 'vue';
import type { IFileBrowserSourceAdapter } from '~/composables/file-manager/IFileBrowserSourceAdapter';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useUiStore } from '~/stores/ui.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import {
  downloadRemoteFile,
  getRemoteFileDownloadUrl,
  getRemoteThumbnailUrl,
  isRemoteFsEntry,
  type RemoteFsEntry,
} from '~/utils/remote-vfs';
import type { RemoteVfsEntry, RemoteVfsFileEntry } from '~/types/remote-vfs';
import type { FsEntry } from '~/types/fs';
import type { BloggerDogEntryPayload, BdEntryType } from '~/types/bloggerdog';
import {
  useDraggedFile,
  FILE_MANAGER_COPY_DRAG_TYPE,
  FILE_MANAGER_MOVE_DRAG_TYPE,
  type DraggedFileData,
} from '~/composables/useDraggedFile';
import { useVfs } from '~/composables/useVfs';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import {
  getDropTargetEntryPathFromEl,
  resolveFileManagerDragOperation,
  resolveFileManagerDropOperation,
} from '~/composables/file-manager/dragOperation';
import { crossVfsCopy, crossVfsMove } from '~/file-manager/core/vfs/crossVfs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { useDndDropZone } from '~/composables/dnd/useDndDropZone';
import type { DndDragContext, DndPayload, DndPointer } from '~/composables/dnd/dndTypes';

function getBdType(entry: FsEntry): string | undefined {
  return (entry.adapterPayload as BloggerDogEntryPayload | undefined)?.type;
}

export interface UseFileBrowserRemoteOptions {
  isRemoteMode: Ref<boolean>;
  remoteCurrentFolder: Ref<FsEntry | null>;
  folderEntries: Ref<FsEntry[]>;
  loadFolderContent: () => Promise<void>;
  loadParentFolders: () => Promise<void>;
  navigateToRoot: () => Promise<void>;
  setSelectedFsEntry: (entry: FsEntry | null) => void;
  vfs: IFileSystemAdapter;
  // Pointer-DnD base API (internal drags).
  startEntryDrag: (e: PointerEvent, entry: FsEntry) => void;
  handleInternalDragOver: (ctx: DndDragContext) => void;
  handleInternalDragLeave: (ctx: DndDragContext) => void;
  handleInternalDrop: (ctx: DndDragContext) => void | Promise<void>;
  // OS `Files` (HTML5) root handlers.
  onRootDragEnter: (e: DragEvent) => void;
  onRootDragOver: (e: DragEvent) => void;
  onRootDragLeave: (e: DragEvent) => void;
  onRootDrop: (e: DragEvent) => void;
  fileManagerInstanceId?: string | null;
  handleFiles: (
    files: File[] | FileList,
    options?: {
      targetDirPath?: string;
      abortSignal?: AbortSignal;
      onProgress?: (params: {
        currentFileIndex: number;
        totalFiles: number;
        fileName: string;
      }) => void;
    },
  ) => Promise<unknown>;
}

export function useFileBrowserRemote({
  isRemoteMode,
  remoteCurrentFolder,
  folderEntries,
  loadFolderContent,
  loadParentFolders,
  navigateToRoot,
  setSelectedFsEntry,
  vfs,
  startEntryDrag,
  handleInternalDragOver,
  handleInternalDragLeave,
  handleInternalDrop,
  onRootDragEnter,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  fileManagerInstanceId,
  handleFiles,
}: UseFileBrowserRemoteOptions) {
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
    useFileManagerStore();
  const workspaceStore = useWorkspaceStore();
  const uiStore = useUiStore();
  const runtimeConfig = useRuntimeConfig();
  const toast = useToast();
  const { t } = useI18n();
  const { setDraggedFile } = useDraggedFile();
  const appClipboard = useAppClipboard();
  const rootVfs = useVfs();

  const lastLocalFolder = ref<FsEntry | null>(null);

  const remoteTransferOpen = ref(false);
  const remoteTransferProgress = ref(0);
  const remoteTransferPhase = ref('');
  const remoteTransferFileName = ref('');
  const remoteTransferAbortController = ref<AbortController | null>(null);
  const remoteError = ref<string | null>(null);

  const PAGINATION_LIMIT = 50;
  const remoteCurrentOffset = ref(0);
  const remoteTotalItems = ref(0);
  const isLoadingMore = ref(false);

  const remoteHasMore = computed(() => {
    return folderEntries.value.length < remoteTotalItems.value;
  });

  const bloggerDogApiUrl = computed(() =>
    typeof runtimeConfig.public.bloggerDogApiUrl === 'string'
      ? runtimeConfig.public.bloggerDogApiUrl
      : '',
  );

  const remoteFilesConfig = computed(() =>
    resolveExternalServiceConfig({
      service: 'files',
      integrations: workspaceStore.userSettings.integrations,
      bloggerDogApiUrl: bloggerDogApiUrl.value,
    }),
  );

  const isRemoteAvailable = computed(() => Boolean(remoteFilesConfig.value));

  function buildRemoteDirectoryEntry(
    path: string,
    type: BdEntryType = 'virtual-folder',
  ): RemoteFsEntry {
    let normalizedPath = path || '/';
    if (!normalizedPath.startsWith('/remote')) {
      normalizedPath = `/remote${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
    }
    const leaf = normalizedPath.split('/').filter(Boolean).at(-1);
    const name =
      normalizedPath === '/remote'
        ? t('fastcat.bloggerDog.contentLibrary')
        : normalizedPath === '/remote/virtual-all'
          ? t('fastcat.bloggerDog.allContent')
          : normalizedPath === '/remote/projects'
            ? t('fastcat.bloggerDog.projectLibraries')
            : normalizedPath === '/remote/personal'
              ? t('fastcat.bloggerDog.personalLibrary')
              : leaf || t('fastcat.bloggerDog.contentLibrary');
    const remoteData: RemoteVfsEntry = {
      id: normalizedPath,
      name,
      path: normalizedPath,
      type: 'directory',
    };
    const payload: BloggerDogEntryPayload = {
      type,
      remoteData,
    };
    return {
      name,
      kind: 'directory',
      path: normalizedPath,
      source: 'remote',
      remoteId: normalizedPath,
      remotePath: normalizedPath,
      remoteType: 'directory',
      adapterPayload: payload,
      mimeType: 'folder',
    };
  }

  async function loadRemoteFolderContent(options: { append?: boolean } = {}): Promise<boolean> {
    if (!isRemoteMode.value) return false;

    if (!remoteCurrentFolder.value || !remoteFilesConfig.value) {
      folderEntries.value = [];
      remoteTotalItems.value = 0;
      remoteCurrentOffset.value = 0;
      return true;
    }

    if (!options.append) {
      remoteCurrentOffset.value = 0;
    }

    if (options.append) {
      isLoadingMore.value = true;
    }

    try {
      // Use VFS instead of direct API call to benefit from BloggerDogVfsAdapter logic (like Content Item-as-folder)
      const path = remoteCurrentFolder.value.remotePath || '/remote';
      const items = await vfs.readDirectory(path, {
        sortBy: fileManagerStore.sortOption.field,
        sortOrder: fileManagerStore.sortOption.order,
        limit: PAGINATION_LIMIT,
        offset: remoteCurrentOffset.value,
      });
      remoteError.value = null;

      // Update total items count from VFS response (if available)
      if (typeof (items as { total?: number }).total === 'number') {
        remoteTotalItems.value = (items as { total?: number }).total ?? 0;
      } else if (!options.append) {
        // Fallback for folders that don't support pagination or virtual root folders
        remoteTotalItems.value = items.length;
      }

      const newEntries = items.map((entryRaw: unknown) => {
        const entry = entryRaw as Record<string, unknown>;
        const bdPayloadRaw = entry.adapterPayload as { thumbnailUrl?: string } | undefined;
        const bdPayload = bdPayloadRaw as Record<string, unknown> | undefined;
        const thumbnailUrl = bdPayload?.thumbnailUrl as string | undefined;

        const extendedEntry: Record<string, unknown> = {
          ...entry,
          source: 'remote',
          remotePath: entry.path,
          remoteId:
            (bdPayload?.remoteData as Record<string, unknown>)?.id || entry.id || entry.path,
          adapterPayload: bdPayloadRaw,
        };

        if (thumbnailUrl) {
          extendedEntry.objectUrl = getRemoteThumbnailUrl({
            baseUrl: remoteFilesConfig.value!.baseUrl,
            media: { thumbnailUrl } as import('~/types/remote-vfs').RemoteVfsMedia,
          });
        }

        return extendedEntry;
      });

      if (options.append) {
        folderEntries.value = [
          ...folderEntries.value,
          ...(newEntries as unknown as import('~/types/fs').FsEntry[]),
        ];
        remoteCurrentOffset.value += items.length;
      } else {
        folderEntries.value = newEntries as unknown as import('~/types/fs').FsEntry[];
        remoteCurrentOffset.value = items.length;
      }
    } catch (error) {
      remoteError.value = error instanceof Error ? error.message : 'Failed to load remote folder';
      if (!options.append) {
        folderEntries.value = [];
      }
    } finally {
      isLoadingMore.value = false;
    }
    return true;
  }

  function loadRemoteParentFolders(parentFolders: Ref<FsEntry[]>): boolean {
    if (!isRemoteMode.value) return false;
    const currentPath = remoteCurrentFolder.value?.remotePath || '/remote';
    const parts = currentPath.split('/').filter(Boolean);
    // Parts: ['remote', 'collectionId', ...]
    let accum = '';
    const result: FsEntry[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accum = `${accum}/${part}`;
      // Include the root '/remote' (labeled as BloggerDog) in breadcrumbs for consistency with local explorer
      // if (i === 0) continue;
      result.push(buildRemoteDirectoryEntry(accum));
    }
    parentFolders.value = result;
    return true;
  }

  async function toggleRemoteMode() {
    if (!isRemoteAvailable.value) return;

    if (!isRemoteMode.value) {
      if (fileManagerStore.selectedFolder) {
        fileManagerStore.addToHistory({ ...fileManagerStore.selectedFolder });
      }
      lastLocalFolder.value = fileManagerStore.selectedFolder;
      isRemoteMode.value = true;
      remoteCurrentFolder.value = buildRemoteDirectoryEntry('/remote');
      await loadFolderContent();
      await loadParentFolders();
      setSelectedFsEntry(remoteCurrentFolder.value);
      return;
    }

    if (remoteCurrentFolder.value) {
      fileManagerStore.addToHistory({ ...remoteCurrentFolder.value });
    }
    isRemoteMode.value = false;
    remoteCurrentFolder.value = null;
    await loadParentFolders();
    if (lastLocalFolder.value) {
      fileManagerStore.openFolder(lastLocalFolder.value);
    } else {
      await navigateToRoot();
    }
  }

  async function performRemoteDownload(params: { entry: RemoteFsEntry; targetDirPath: string }) {
    const config = remoteFilesConfig.value;
    if (!config || params.entry.kind !== 'file') return;

    const remoteFile = (params.entry.adapterPayload as BloggerDogEntryPayload | undefined)
      ?.remoteData as RemoteVfsFileEntry | undefined;
    if (!remoteFile) return;
    const downloadUrl = getRemoteFileDownloadUrl({ baseUrl: config.baseUrl, entry: remoteFile });
    if (!downloadUrl) throw new Error('Remote file download URL is missing');

    const controller = new AbortController();
    remoteTransferAbortController.value = controller;
    remoteTransferFileName.value = params.entry.name;
    remoteTransferProgress.value = 0;
    remoteTransferPhase.value = t('videoEditor.fileManager.actions.downloadFiles');
    remoteTransferOpen.value = true;

    try {
      const blob = await downloadRemoteFile({
        url: downloadUrl,
        signal: controller.signal,
        onProgress: (progress) => {
          remoteTransferProgress.value = progress;
        },
      });

      const file = new File([blob], params.entry.name, {
        type: blob.type || params.entry.mimeType || 'application/octet-stream',
      });

      remoteTransferPhase.value = t('videoEditor.fileManager.actions.uploadFiles');
      await handleFiles([file], { targetDirPath: params.targetDirPath });
      uiStore.notifyFileManagerUpdate();
      await loadFolderContent();
    } finally {
      remoteTransferAbortController.value = null;
      remoteTransferOpen.value = false;
      remoteTransferProgress.value = 0;
      remoteTransferPhase.value = '';
      remoteTransferFileName.value = '';
    }
  }

  function cancelRemoteTransfer() {
    remoteTransferAbortController.value?.abort();
  }

  function isBloggerDogContentItemEntry(entry: FsEntry): boolean {
    return getBdType(entry) === 'content-item';
  }

  function isBloggerDogMediaEntry(entry: FsEntry): boolean {
    return getBdType(entry) === 'media';
  }

  function isBloggerDogDraggableEntry(entry: FsEntry): boolean {
    const type = getBdType(entry);
    return type === 'media' || type === 'collection' || type === 'content-item';
  }

  function resolveRemoteDropOperation(event: DragEvent): 'copy' | 'move' {
    return resolveFileManagerDropOperation({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      isLayer1Active: isLayer1Active(event, workspaceStore.userSettings),
      targetFileManagerInstanceId: fileManagerInstanceId ?? null,
      currentDragOperation: appClipboard.currentDragOperation,
      fallbackRawOperation: event.dataTransfer?.types.includes(FILE_MANAGER_MOVE_DRAG_TYPE)
        ? 'move'
        : event.dataTransfer?.types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
          ? 'copy'
          : null,
    });
  }

  async function handleProjectToRemoteDrop(params: { event: DragEvent; targetEntry: FsEntry }) {
    const copyRaw = params.event.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
    const moveRaw = params.event.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
    const internalRaw = copyRaw || moveRaw;
    if (!internalRaw) return false;

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(internalRaw);
    } catch {
      return false;
    }

    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (
      items.length === 0 ||
      items.some(
        (item) =>
          !item ||
          typeof item !== 'object' ||
          item.kind !== 'file' ||
          typeof item.path !== 'string' ||
          item.path.length === 0,
      )
    ) {
      throw new Error(t('fastcat.bloggerDog.dragDrop.onlyFilesToItem'));
    }

    const sourceVfs =
      appClipboard.dragSourceVfs ??
      appClipboard.getFileManagerVfs(appClipboard.dragSourceFileManagerInstanceId) ??
      rootVfs;
    const operation = resolveRemoteDropOperation(params.event);

    for (const item of items as Array<{ path: string }>) {
      if (operation === 'copy') {
        await crossVfsCopy({
          sourceVfs,
          targetVfs: vfs,
          sourcePath: item.path,
          sourceKind: 'file',
          targetDirPath: params.targetEntry.path,
        });
      } else {
        await crossVfsMove({
          sourceVfs,
          targetVfs: vfs,
          sourcePath: item.path,
          sourceKind: 'file',
          targetDirPath: params.targetEntry.path,
        });
      }
    }

    uiStore.notifyFileManagerUpdate();
    await loadFolderContent();
    return true;
  }

  function isLayer1FromPointer(p: DndPointer): boolean {
    return isLayer1Active(
      {
        shiftKey: p.shiftKey,
        ctrlKey: p.ctrlKey,
        altKey: p.altKey,
        metaKey: p.metaKey,
      } as unknown as MouseEvent,
      workspaceStore.userSettings,
    );
  }

  // --- source: arm a pointer drag from a file/grid row -----------------------
  function startBrowserEntryDrag(e: PointerEvent, entry: FsEntry) {
    if (isRemoteMode.value && (isRemoteFsEntry(entry) || entry.source === 'remote')) {
      if (!isBloggerDogDraggableEntry(entry)) return;

      startEntryDrag(e, entry);

      if (isBloggerDogMediaEntry(entry)) {
        const operation = appClipboard.currentDragOperation ?? 'copy';
        const data: DraggedFileData = {
          name: entry.name,
          path: entry.path,
          kind: 'file',
          operation: operation as 'copy' | 'move',
          isExternal: true,
        };
        setDraggedFile(data);
      }
      return;
    }
    startEntryDrag(e, entry);
  }

  // --- remote (bloggerdog) internal drop, in-memory --------------------------
  function resolveRemoteTargetEntry(targetEl: Element | null): FsEntry | null {
    const path = getDropTargetEntryPathFromEl(targetEl);
    const hovered = path ? folderEntries.value.find((it) => it.path === path) : null;
    if (hovered && isBloggerDogContentItemEntry(hovered)) return hovered;
    const current = remoteCurrentFolder.value;
    return current && isBloggerDogContentItemEntry(current) ? current : null;
  }

  function resolveRemoteDropOperationFromPointer(p: DndPointer): 'copy' | 'move' {
    return resolveFileManagerDropOperation({
      dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
      isLayer1Active: isLayer1FromPointer(p),
      targetFileManagerInstanceId: fileManagerInstanceId ?? null,
      currentDragOperation: appClipboard.currentDragOperation,
      fallbackRawOperation:
        appClipboard.currentDragOperation === 'copy'
          ? 'copy'
          : appClipboard.currentDragOperation === 'move'
            ? 'move'
            : null,
    });
  }

  async function handleProjectToRemoteDropInMemory(params: {
    targetEntry: FsEntry;
    pointer: DndPointer;
  }) {
    const items = appClipboard.draggedItems as Array<{ path?: unknown; kind?: unknown }>;
    if (items.length === 0) return;
    if (
      items.some(
        (item) =>
          !item || item.kind !== 'file' || typeof item.path !== 'string' || item.path.length === 0,
      )
    ) {
      throw new Error(t('fastcat.bloggerDog.dragDrop.onlyFilesToItem'));
    }

    const sourceVfs =
      appClipboard.dragSourceVfs ??
      appClipboard.getFileManagerVfs(appClipboard.dragSourceFileManagerInstanceId) ??
      rootVfs;
    const operation = resolveRemoteDropOperationFromPointer(params.pointer);

    for (const item of items as Array<{ path: string }>) {
      if (operation === 'copy') {
        await crossVfsCopy({
          sourceVfs,
          targetVfs: vfs,
          sourcePath: item.path,
          sourceKind: 'file',
          targetDirPath: params.targetEntry.path,
        });
      } else {
        await crossVfsMove({
          sourceVfs,
          targetVfs: vfs,
          sourcePath: item.path,
          sourceKind: 'file',
          targetDirPath: params.targetEntry.path,
        });
      }
    }

    uiStore.notifyFileManagerUpdate();
    await loadFolderContent();
  }

  // --- unified internal drop zone (branches remote vs local) -----------------
  const { zoneAttrs: dndZoneAttrs } = useDndDropZone(
    {
      canAccept: (payload: DndPayload) => payload.source === 'file-manager',
      onEnter: (ctx) => onZoneOver(ctx),
      onOver: (ctx) => onZoneOver(ctx),
      onLeave: (ctx) => onZoneLeave(ctx),
      onDrop: (ctx) => onZoneDrop(ctx),
    },
    'file-browser',
  );

  function onZoneOver(ctx: DndDragContext) {
    if (!isRemoteMode.value) {
      handleInternalDragOver(ctx);
      return;
    }
    const target = resolveRemoteTargetEntry(ctx.targetEl);
    if (target) {
      appClipboard.setDragTargetFileManagerInstanceId(fileManagerInstanceId ?? null);
      ctx.setOperation(resolveRemoteDropOperationFromPointer(ctx.pointer));
    } else {
      ctx.setOperation('cancel');
    }
  }

  function onZoneLeave(ctx: DndDragContext) {
    if (!isRemoteMode.value) {
      handleInternalDragLeave(ctx);
      return;
    }
    appClipboard.setDragTargetFileManagerInstanceId(null);
  }

  async function onZoneDrop(ctx: DndDragContext) {
    if (!isRemoteMode.value) {
      await handleInternalDrop(ctx);
      return;
    }
    const target = resolveRemoteTargetEntry(ctx.targetEl);
    if (!target) return;
    try {
      await handleProjectToRemoteDropInMemory({ targetEntry: target, pointer: ctx.pointer });
    } catch (error) {
      toast.add({
        color: 'error',
        title: t('videoEditor.fileManager.errors.uploadFailedTitle'),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      appClipboard.setDragTargetFileManagerInstanceId(null);
    }
  }

  function onBrowserRootDragEnter(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDragEnter?.(e);

    if (remoteCurrentFolder.value && isBloggerDogContentItemEntry(remoteCurrentFolder.value)) {
      e.preventDefault();
    }
  }
  function onBrowserRootDragOver(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDragOver?.(e);

    if (remoteCurrentFolder.value && isBloggerDogContentItemEntry(remoteCurrentFolder.value)) {
      e.preventDefault();
      if (
        e.dataTransfer?.types.includes(FILE_MANAGER_COPY_DRAG_TYPE) ||
        e.dataTransfer?.types.includes(FILE_MANAGER_MOVE_DRAG_TYPE)
      ) {
        appClipboard.setDragTargetFileManagerInstanceId(fileManagerInstanceId ?? null);
        appClipboard.setCurrentDragOperation(
          resolveFileManagerDragOperation({
            dragSourceFileManagerInstanceId: appClipboard.dragSourceFileManagerInstanceId,
            isLayer1Active: isLayer1Active(e, workspaceStore.userSettings),
            targetFileManagerInstanceId: fileManagerInstanceId ?? null,
          }),
        );
      }
      e.dataTransfer!.dropEffect =
        e.dataTransfer?.types.includes('Files') || resolveRemoteDropOperation(e) === 'copy'
          ? 'copy'
          : 'move';
    }
  }
  function onBrowserRootDragLeave(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDragLeave?.(e);
    appClipboard.setDragTargetFileManagerInstanceId(null);
  }
  async function onBrowserRootDrop(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDrop?.(e);

    const target = remoteCurrentFolder.value;
    if (!target || !isBloggerDogContentItemEntry(target)) return;

    e.preventDefault();
    e.stopPropagation();

    try {
      const handledInternalDrop = await handleProjectToRemoteDrop({
        event: e,
        targetEntry: target,
      });
      if (handledInternalDrop) {
        return;
      }

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      await handleFiles(files, { targetDirPath: target.path });
      uiStore.notifyFileManagerUpdate();
      await loadFolderContent();
    } catch (error) {
      toast.add({
        color: 'error',
        title: t('videoEditor.fileManager.errors.uploadFailedTitle'),
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      appClipboard.setDragTargetFileManagerInstanceId(null);
    }
  }

  watch(
    () => fileManagerStore.sortOption,
    () => {
      if (isRemoteMode.value) {
        void loadRemoteFolderContent();
      }
    },
    { deep: true },
  );

  function createAdapter(): IFileBrowserSourceAdapter {
    return {
      loadFolder: loadRemoteFolderContent,
      buildParentFolders: loadRemoteParentFolders,
      buildEntry: buildRemoteDirectoryEntry,
    };
  }

  return {
    isRemoteMode,
    remoteCurrentFolder,
    remoteTransferOpen,
    remoteTransferProgress,
    remoteTransferPhase,
    remoteTransferFileName,
    remoteError,
    remoteTotalItems,
    remoteHasMore,
    isLoadingMore,
    remoteFilesConfig,
    isRemoteAvailable,
    buildRemoteDirectoryEntry,
    loadRemoteFolderContent,
    loadRemoteParentFolders,
    toggleRemoteMode,
    performRemoteDownload,
    cancelRemoteTransfer,
    startBrowserEntryDrag,
    dndZoneAttrs,
    onBrowserRootDragEnter,
    onBrowserRootDragOver,
    onBrowserRootDragLeave,
    onBrowserRootDrop,
    createAdapter,
  };
}
