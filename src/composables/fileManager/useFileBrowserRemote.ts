import { ref, computed } from 'vue';
import type { Ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import {
  downloadRemoteFile,
  fetchRemoteVfsList,
  getRemoteFileDownloadUrl,
  isRemoteFsEntry,
  type RemoteFsEntry,
  toRemoteFsEntry,
} from '~/utils/remote-vfs';
import type { RemoteVfsEntry, RemoteVfsFileEntry } from '~/types/remote-vfs';
import type { FsEntry } from '~/types/fs';
import {
  INTERNAL_DRAG_TYPE,
  REMOTE_FILE_DRAG_TYPE,
  useDraggedFile,
} from '~/composables/useDraggedFile';
import type { DraggedFileData } from '~/composables/useDraggedFile';

export function useFileBrowserRemote({
  isRemoteMode,
  remoteCurrentFolder,
  folderEntries,
  loadFolderContent,
  loadParentFolders,
  navigateToRoot,
  setSelectedFsEntry,
  onEntryDragStart,
  onEntryDragEnd,
  onEntryDragOver,
  onEntryDragLeave,
  onEntryDrop,
  onRootDragOver,
  onRootDragLeave,
  onRootDrop,
  handleFiles,
}: {
  isRemoteMode: Ref<boolean>;
  remoteCurrentFolder: Ref<RemoteFsEntry | null>;
  folderEntries: Ref<FsEntry[]>;
  loadFolderContent: () => Promise<void>;
  loadParentFolders: () => Promise<void>;
  navigateToRoot: () => Promise<void>;
  setSelectedFsEntry: (entry: FsEntry | null) => void;
  onEntryDragStart: (e: DragEvent, entry: FsEntry) => void;
  onEntryDragEnd: () => void;
  onEntryDragOver: (e: DragEvent, entry: FsEntry) => void;
  onEntryDragLeave: (e: DragEvent, entry: FsEntry) => void;
  onEntryDrop: (e: DragEvent, entry: FsEntry) => Promise<void>;
  onRootDragOver: (e: DragEvent) => void;
  onRootDragLeave: (e: DragEvent) => void;
  onRootDrop: (e: DragEvent) => Promise<void>;
  handleFiles: (files: File[], dirPath?: string) => Promise<void>;
}) {
  const workspaceStore = useWorkspaceStore();
  const uiStore = useUiStore();
  const runtimeConfig = useRuntimeConfig();
  const toast = useToast();
  const { t } = useI18n();

  const lastLocalFolder = ref<FsEntry | null>(null);

  const remoteTransferOpen = ref(false);
  const remoteTransferProgress = ref(0);
  const remoteTransferPhase = ref('');
  const remoteTransferFileName = ref('');
  const remoteTransferAbortController = ref<AbortController | null>(null);

  const fastcatBaseUrl = computed(() =>
    typeof runtimeConfig.public.fastcatPublicadorBaseUrl === 'string'
      ? runtimeConfig.public.fastcatPublicadorBaseUrl
      : '',
  );

  const remoteFilesConfig = computed(() =>
    resolveExternalServiceConfig({
      service: 'files',
      integrations: workspaceStore.userSettings.integrations,
      fastcatPublicadorBaseUrl: fastcatBaseUrl.value,
    }),
  );

  const isRemoteAvailable = computed(() => Boolean(remoteFilesConfig.value));

  function buildRemoteDirectoryEntry(path: string): RemoteFsEntry {
    const normalizedPath = path || '/';
    const name =
      normalizedPath === '/'
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
      const response = await fetchRemoteVfsList({
        config: remoteFilesConfig.value,
        path: remoteCurrentFolder.value.remotePath || '/',
      });
      folderEntries.value = response.items.map((entry) => toRemoteFsEntry(entry));
    } catch (error) {
      console.error('Failed to load remote folder content:', error);
      folderEntries.value = [];
      toast.add({
        color: 'error',
        title: t('common.error', 'Error'),
        description: error instanceof Error ? error.message : 'Failed to load remote folder',
      });
    }
    return true;
  }

  function loadRemoteParentFolders(parentFolders: Ref<FsEntry[]>): boolean {
    if (!isRemoteMode.value) return false;
    const currentPath = remoteCurrentFolder.value?.remotePath || '/';
    const parts = currentPath.split('/').filter(Boolean);
    let accum = '';
    for (const part of parts) {
      accum = `${accum}/${part}`;
      parentFolders.value.push(buildRemoteDirectoryEntry(accum));
    }
    return true;
  }

  function openRemoteExchangeModal() {
    uiStore.remoteExchangeModalOpen = true;
  }

  async function toggleRemoteMode(filesPageStore: {
    selectedFolder: FsEntry | null;
    selectFolder: (e: FsEntry) => void;
  }) {
    if (!isRemoteAvailable.value) return;

    if (!isRemoteMode.value) {
      lastLocalFolder.value = filesPageStore.selectedFolder;
      isRemoteMode.value = true;
      remoteCurrentFolder.value = buildRemoteDirectoryEntry('/');
      await loadFolderContent();
      await loadParentFolders();
      setSelectedFsEntry(remoteCurrentFolder.value);
      return;
    }

    isRemoteMode.value = false;
    remoteCurrentFolder.value = null;
    await loadParentFolders();
    if (lastLocalFolder.value) {
      filesPageStore.selectFolder(lastLocalFolder.value);
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
    if (isRemoteMode.value && isRemoteFsEntry(entry)) {
      if (entry.kind !== 'file' || !e.dataTransfer) return;

      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData(REMOTE_FILE_DRAG_TYPE, JSON.stringify(entry));
      e.dataTransfer.setData(INTERNAL_DRAG_TYPE, '1');

      const data: DraggedFileData = { name: entry.name, kind: 'file', path: entry.remotePath };
      useDraggedFile().setDraggedFile(data);
      e.dataTransfer.setData('application/json', JSON.stringify(data));
      return;
    }
    onEntryDragStart(e, entry);
  }

  function onBrowserEntryDragEnd() {
    useDraggedFile().clearDraggedFile();
    onEntryDragEnd();
  }

  function onBrowserEntryDragOver(e: DragEvent, entry: FsEntry) {
    if (isRemoteMode.value) return;
    onEntryDragOver(e, entry);
  }

  function onBrowserEntryDragLeave(e: DragEvent, entry: FsEntry) {
    if (isRemoteMode.value) return;
    onEntryDragLeave(e, entry);
  }

  async function onBrowserEntryDrop(e: DragEvent, entry: FsEntry) {
    if (isRemoteMode.value) return;
    await onEntryDrop(e, entry);
  }

  function onBrowserRootDragOver(e: DragEvent) {
    if (isRemoteMode.value) return;
    onRootDragOver(e);
  }

  function onBrowserRootDragLeave(e: DragEvent) {
    if (isRemoteMode.value) return;
    onRootDragLeave(e);
  }

  async function onBrowserRootDrop(e: DragEvent) {
    if (isRemoteMode.value) return;
    await onRootDrop(e);
  }

  return {
    isRemoteMode,
    remoteCurrentFolder,
    remoteTransferOpen,
    remoteTransferProgress,
    remoteTransferPhase,
    remoteTransferFileName,
    remoteFilesConfig,
    isRemoteAvailable,
    buildRemoteDirectoryEntry,
    loadRemoteFolderContent,
    loadRemoteParentFolders,
    openRemoteExchangeModal,
    toggleRemoteMode,
    performRemoteDownload,
    cancelRemoteTransfer,
    onBrowserEntryDragStart,
    onBrowserEntryDragEnd,
    onBrowserEntryDragOver,
    onBrowserEntryDragLeave,
    onBrowserEntryDrop,
    onBrowserRootDragOver,
    onBrowserRootDragLeave,
    onBrowserRootDrop,
  };
}
