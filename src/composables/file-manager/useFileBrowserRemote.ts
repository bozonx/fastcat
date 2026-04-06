import { ref, computed, watch, inject } from 'vue';
import type { Ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useUiStore } from '~/stores/ui.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import {
  downloadRemoteFile,
  fetchRemoteVfsList,
  getRemoteFileDownloadUrl,
  getRemoteThumbnailUrl,
  isRemoteFsEntry,
  type RemoteFsEntry,
} from '~/utils/remote-vfs';
import type { RemoteVfsEntry, RemoteVfsFileEntry } from '~/types/remote-vfs';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { REMOTE_FILE_DRAG_TYPE, useDraggedFile } from '~/composables/useDraggedFile';

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
  handleFiles: (files: File[] | FileList, targetDirPath?: string) => Promise<void>;
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
  const fileManagerStore = (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) || useFileManagerStore();
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
    const name =
      normalizedPath === '/remote'
        ? 'Remote'
        : normalizedPath.split('/').filter(Boolean).at(-1) || 'Remote';
    const remoteData: RemoteVfsEntry = {
      id: normalizedPath,
      name,
      path: normalizedPath,
      type: 'directory',
    };
    return {
      name,
      kind: 'directory',
      path: normalizedPath,
      source: 'remote',
      remoteId: normalizedPath,
      remotePath: normalizedPath,
      remoteType: 'directory',
      remoteData,
      mimeType: 'folder',
      size: 0,
    };
  }

  async function loadRemoteFolderContent(): Promise<boolean> {
    if (!isRemoteMode.value) return false;

    if (!remoteCurrentFolder.value || !remoteFilesConfig.value) {
      folderEntries.value = [];
      return true;
    }

    try {
      // Use VFS instead of direct API call to benefit from BloggerDogVfsAdapter logic (like Content Item-as-folder)
      const path = remoteCurrentFolder.value.remotePath || '/remote';
      const items = await vfs.readDirectory(path, {
        sortBy: fileManagerStore.sortOption.field,
        sortOrder: fileManagerStore.sortOption.order,
      });
      remoteError.value = null;
      
      folderEntries.value = items.map((entry: any) => {
        // Ensure entrance into Content Items works by marking them as remote
        const extendedEntry = {
          ...entry,
          source: 'remote',
          remotePath: entry.path,
          remoteId: entry.id || entry.path,
          remoteData: entry.remoteData,
          isContentItem: entry.isContentItem,
        };

        // Resolve thumbnail for content items or media
        if (extendedEntry.remoteThumbnailUrl || extendedEntry.objectUrl) {
          if (!extendedEntry.objectUrl && extendedEntry.remoteThumbnailUrl) {
             extendedEntry.objectUrl = getRemoteThumbnailUrl({
                baseUrl: remoteFilesConfig.value!.baseUrl,
                media: { thumbnailUrl: extendedEntry.remoteThumbnailUrl } as any,
              });
          }
        }
        return extendedEntry;
      });
    } catch (error) {
      remoteError.value = error instanceof Error ? error.message : 'Failed to load remote folder';
      folderEntries.value = [];
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
      if (i === 0) continue; // Skip single '/remote' for breadcrumbs if needed, or include it
      result.push(buildRemoteDirectoryEntry(accum));
    }
    parentFolders.value = result;
    return true;
  }

  async function toggleRemoteMode(fileManagerStore: {
    selectedFolder: FsEntry | null;
    openFolder: (e: FsEntry) => void;
  }) {
    if (!isRemoteAvailable.value) return;

    if (!isRemoteMode.value) {
      lastLocalFolder.value = fileManagerStore.selectedFolder;
      isRemoteMode.value = true;
      remoteCurrentFolder.value = buildRemoteDirectoryEntry('/remote');
      await loadFolderContent();
      await loadParentFolders();
      setSelectedFsEntry(remoteCurrentFolder.value);
      return;
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

    const remoteFile = params.entry.remoteData as RemoteVfsFileEntry;
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
      await handleFiles([file], params.targetDirPath);
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
      if (entry.kind !== 'file' || !e.dataTransfer) return;

      e.dataTransfer.effectAllowed = 'copy';
      const data = {
        name: entry.name,
        path: entry.path,
        kind: 'file',
        operation: 'copy',
        isExternal: true,
      };
      e.dataTransfer.setData(REMOTE_FILE_DRAG_TYPE, JSON.stringify(data));
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
    if (!isRemoteMode.value && onEntryDragEnter) return onEntryDragEnter(e, entry);
  }
  function onBrowserEntryDragOver(e: DragEvent, entry: FsEntry) {
    if (!isRemoteMode.value) return onEntryDragOver(e, entry);
  }
  function onBrowserEntryDragLeave(e: DragEvent, entry: FsEntry) {
    if (!isRemoteMode.value) return onEntryDragLeave(e, entry);
  }
  function onBrowserEntryDrop(e: DragEvent, entry: FsEntry) {
    if (!isRemoteMode.value) return onEntryDrop(e, entry);
  }

  function onBrowserRootDragEnter(e: DragEvent) {
    if (!isRemoteMode.value && onRootDragEnter) return onRootDragEnter(e);
  }
  function onBrowserRootDragOver(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDragOver(e);
  }
  function onBrowserRootDragLeave(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDragLeave(e);
  }
  function onBrowserRootDrop(e: DragEvent) {
    if (!isRemoteMode.value) return onRootDrop(e);
  }

  return {
    isRemoteMode,
    remoteCurrentFolder,
    remoteTransferOpen,
    remoteTransferProgress,
    remoteTransferPhase,
    remoteTransferFileName,
    remoteError,
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
