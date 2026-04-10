import { ref, computed, watch, inject } from 'vue';
import type { Ref } from 'vue';
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
import type { BloggerDogEntryPayload, getBdPayload } from '~/types/bloggerdog';
import { useProjectStore } from '~/stores/project.store';
import {
  REMOTE_FILE_DRAG_TYPE,
  useDraggedFile,
  FILE_MANAGER_COPY_DRAG_TYPE,
  INTERNAL_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import { useVfs } from '~/composables/useVfs';

function getBdType(entry: FsEntry): string | undefined {
  return (entry.adapterPayload as ReturnType<typeof getBdPayload>)?.type;
}

export interface UseFileBrowserRemoteOptions {
  isRemoteMode: Ref<boolean>;
  remoteCurrentFolder: Ref<FsEntry | null>;
  folderEntries: Ref<FsEntry[]>;
  loadFolderContent: () => Promise<void>;
  loadParentFolders: () => Promise<void>;
  navigateToRoot: () => Promise<void>;
  setSelectedFsEntry: (entry: FsEntry | null) => void;
  vfs: any; // Using any for VFS adapter to avoid generic type complexities here
  onEntryDragStart: (e: DragEvent, entry: FsEntry) => void;
  onEntryDragEnd: () => void;
  onEntryDragEnter: (e: DragEvent, entry: FsEntry) => void;
  onEntryDragOver: (e: DragEvent, entry: FsEntry) => void;
  onEntryDragLeave: (e: DragEvent, entry: FsEntry) => void;
  onEntryDrop: (e: DragEvent, entry: FsEntry) => void;
  onRootDragEnter: (e: DragEvent) => void;
  onRootDragOver: (e: DragEvent) => void;
  onRootDragLeave: (e: DragEvent) => void;
  onRootDrop: (e: DragEvent) => void;
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
  ) => Promise<void>;
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
  onEntryDragStart,
  onEntryDragEnd,
  onEntryDragEnter,
  onEntryDragOver,
  onEntryDragLeave,
  onEntryDrop,
  onRootDragEnter,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
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
  const { setDraggedFile, clearDraggedFile } = useDraggedFile();

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

  function buildRemoteDirectoryEntry(path: string): RemoteFsEntry {
    let normalizedPath = path || '/';
    if (!normalizedPath.startsWith('/remote')) {
      normalizedPath = `/remote${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`;
    }
    const leaf = normalizedPath.split('/').filter(Boolean).at(-1);
    const name =
      normalizedPath === '/remote'
        ? t('fastcat.bloggerDog.contentLibrary', 'Библиотека контента')
        : normalizedPath === '/remote/virtual-all'
          ? t('fastcat.bloggerDog.allContent', 'Все элементы')
          : normalizedPath === '/remote/projects'
            ? t('fastcat.bloggerDog.projectLibraries', 'Проекты')
            : normalizedPath === '/remote/personal'
              ? t('fastcat.bloggerDog.personalLibrary', 'Личная библиотека')
              : leaf || t('fastcat.bloggerDog.contentLibrary', 'Библиотека контента');
    const remoteData: RemoteVfsEntry = {
      id: normalizedPath,
      name,
      path: normalizedPath,
      type: 'directory',
    };
    const payload: BloggerDogEntryPayload = {
      type: 'virtual-folder',
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
      size: 0,
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
      if (typeof (items as any).total === 'number') {
        remoteTotalItems.value = (items as any).total;
      } else if (!options.append) {
        // Fallback for folders that don't support pagination or virtual root folders
        remoteTotalItems.value = items.length;
      }

      const newEntries = items.map((entry: any) => {
        const bdPayload = entry.adapterPayload;
        const thumbnailUrl = bdPayload?.thumbnailUrl;

        const extendedEntry: any = {
          ...entry,
          source: 'remote',
          remotePath: entry.path,
          remoteId: bdPayload?.remoteData?.id || entry.id || entry.path,
          adapterPayload: bdPayload,
        };

        if (thumbnailUrl) {
          extendedEntry.objectUrl = getRemoteThumbnailUrl({
            baseUrl: remoteFilesConfig.value!.baseUrl,
            media: { thumbnailUrl } as any,
          });
        }

        return extendedEntry;
      });

      if (options.append) {
        folderEntries.value = [...folderEntries.value, ...newEntries];
        remoteCurrentOffset.value += items.length;
      } else {
        folderEntries.value = newEntries;
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
    remoteTransferPhase.value = t(
      'videoEditor.fileManager.actions.downloadFiles',
      'Download files',
    );
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

      remoteTransferPhase.value = t('videoEditor.fileManager.actions.uploadFiles', 'Upload files');
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

  function onBrowserEntryDragStart(e: DragEvent, entry: FsEntry) {
    if (isRemoteMode.value && (isRemoteFsEntry(entry) || entry.source === 'remote')) {
      // Restriction from user: "можно только перемещать или копировать файлы, но не группы и не элементы контента"
      // Groups are !isContentItem and kind === 'directory'.
      // Content items are isContentItem === true.
      // Media items (drags allowed) are isMediaItem === true AND NOT isContentItem.
      const isContentItem = getBdType(entry) === 'content-item';
      const isMediaItem = getBdType(entry) === 'media';

      // If it's a content item (item-as-folder or item-as-file), we shouldn't allow dragging it.
      // We only allow dragging media items that are components of content items.
      if (!isMediaItem || isContentItem || !e.dataTransfer) {
        return;
      }

      e.dataTransfer.effectAllowed = 'copy';
      const data = {
        name: entry.name,
        path: entry.path,
        kind: 'file',
        operation: 'copy',
        isExternal: true,
      };

      // Use both types for compatibility with local drop handlers
      e.dataTransfer.setData(REMOTE_FILE_DRAG_TYPE, JSON.stringify(data));
      e.dataTransfer.setData(FILE_MANAGER_COPY_DRAG_TYPE, JSON.stringify([data]));
      e.dataTransfer.setData(INTERNAL_DRAG_TYPE, '1');

      setDraggedFile(data as any);
      return;
    }
    return onEntryDragStart(e, entry);
  }
  function onBrowserEntryDragEnd() {
    if (isRemoteMode.value) {
      clearDraggedFile();
      return;
    }
    return onEntryDragEnd();
  }
  function onBrowserEntryDragEnter(e: DragEvent, entry: FsEntry) {
    if (!isRemoteMode.value) return onEntryDragEnter?.(e, entry);

    // Drop into remote: only into "element of content"
    if (getBdType(entry) !== 'content-item' || !e.dataTransfer?.types) return;

    // We only allow dragging files (local) into content items
    const { draggedFile } = useDraggedFile();
    if (draggedFile.value && draggedFile.value.kind !== 'file') return;

    e.preventDefault();
  }
  function onBrowserEntryDragOver(e: DragEvent, entry: FsEntry) {
    if (!isRemoteMode.value) return onEntryDragOver?.(e, entry);

    // Drop into remote: only into "element of content"
    if (getBdType(entry) !== 'content-item' || !e.dataTransfer?.types) return;

    const { draggedFile } = useDraggedFile();
    if (draggedFile.value && draggedFile.value.kind !== 'file') return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy'; // Move is disabled for now
  }
  function onBrowserEntryDragLeave(e: DragEvent, entry: FsEntry) {
    if (!isRemoteMode.value) return onEntryDragLeave?.(e, entry);
  }
  async function onBrowserEntryDrop(e: DragEvent, entry: FsEntry) {
    if (!isRemoteMode.value) return onEntryDrop?.(e, entry);

    // Only allow drop into content item
    if (getBdType(entry) !== 'content-item') return;

    const { draggedFile } = useDraggedFile();
    if (!draggedFile.value || draggedFile.value.kind !== 'file') {
      // Also check native files (e.g. from desktop)
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        await handleFiles(files, { targetDirPath: entry.path });
      }
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const sourcePath = draggedFile.value.path;
    const isRemoteSource = draggedFile.value.isExternal; // Dragged from another remote instance or similar?

    if (!isRemoteSource && sourcePath) {
      // Dragged from local into remote item
      const localVfs = useVfs();
      const blob = await localVfs.readFile(sourcePath);
      const file = new File([blob], draggedFile.value.name, { type: blob.type });

      await handleFiles([file], { targetDirPath: entry.path });
      uiStore.notifyFileManagerUpdate();
      await loadFolderContent();
    }
  }

  function onBrowserRootDragEnter(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDragEnter?.(e);

    if (remoteCurrentFolder.value && getBdType(remoteCurrentFolder.value) === 'content-item') {
      e.preventDefault();
    }
  }
  function onBrowserRootDragOver(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDragOver?.(e);

    if (remoteCurrentFolder.value && getBdType(remoteCurrentFolder.value) === 'content-item') {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    }
  }
  function onBrowserRootDragLeave(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDragLeave?.(e);
  }
  async function onBrowserRootDrop(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDrop?.(e);

    const target = remoteCurrentFolder.value;
    if (!target || getBdType(target) !== 'content-item') return;

    // Reuse the same logic as onBrowserEntryDrop
    const { draggedFile } = useDraggedFile();
    const files = e.dataTransfer?.files;

    if (files && files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      await handleFiles(files, { targetDirPath: target.path });
      uiStore.notifyFileManagerUpdate();
      await loadFolderContent();
    } else if (
      draggedFile.value &&
      draggedFile.value.kind === 'file' &&
      !draggedFile.value.isExternal
    ) {
      e.preventDefault();
      e.stopPropagation();
      const sourcePath = draggedFile.value.path;
      if (sourcePath) {
        const localVfs = useVfs();
        const blob = await localVfs.readFile(sourcePath);
        const file = new File([blob], draggedFile.value.name, { type: blob.type });
        await handleFiles([file], { targetDirPath: target.path });
        uiStore.notifyFileManagerUpdate();
        await loadFolderContent();
      }
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
    onBrowserEntryDragStart,
    onBrowserEntryDragEnd,
    onBrowserEntryDragEnter,
    onBrowserEntryDragOver,
    onBrowserEntryDragLeave,
    onBrowserEntryDrop,
    onBrowserRootDragEnter,
    onBrowserRootDragOver,
    onBrowserRootDragLeave,
    onBrowserRootDrop,
  };
}
