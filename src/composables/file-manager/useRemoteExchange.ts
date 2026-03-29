import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import {
  useDraggedFile,
  FILE_MANAGER_MOVE_DRAG_TYPE,
  INTERNAL_DRAG_TYPE,
  REMOTE_FILE_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import {
  createRemoteCollection,
  createRemoteMediaFsEntry,
  deleteRemoteCollection,
  deleteRemoteItem,
  fetchRemoteVfsList,
  getRemoteEntryDisplayName,
  getRemoteFileDownloadUrl,
  getRemoteThumbnailUrl,
  getRemoteMediaKind,
  searchRemoteVfs,
  toRemoteFsEntry,
  uploadFileToRemote,
} from '~/utils/remote-vfs';
import type { RemoteVfsEntry, RemoteVfsFileEntry, RemoteVfsMedia } from '~/types/remote-vfs';

export function useRemoteExchange() {
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();
  const fileManager = useFileManager();
  const runtimeConfig = useRuntimeConfig();
  const toast = useToast();
  const { t } = useI18n();
  const { setDraggedFile, clearDraggedFile } = useDraggedFile();

  const isOpen = computed({
    get: () => uiStore.remoteExchangeModalOpen,
    set: (value) => {
      uiStore.remoteExchangeModalOpen = value;
    },
  });

  const remoteFilesConfig = computed(() =>
    resolveExternalServiceConfig({
      service: 'files',
      integrations: workspaceStore.userSettings.integrations,
      bloggerDogApiUrl:
        typeof runtimeConfig.public.bloggerDogApiUrl === 'string'
          ? runtimeConfig.public.bloggerDogApiUrl
          : '',
    }),
  );

  const remoteCurrentPath = ref('/');
  const remoteEntries = ref<RemoteVfsEntry[]>([]);
  const remoteLoading = ref(false);
  const selectedEntry = ref<FsEntry | null>(null);
  const previewUrl = ref('');
  const previewPoster = ref('');
  const previewText = ref('');
  const previewKind = ref<'video' | 'audio' | 'image' | 'text' | 'document' | 'unknown'>('unknown');
  const previewLoading = ref(false);
  const libraryDragOver = ref(false);
  const uploadProgressOpen = ref(false);
  const uploadProgress = ref(0);
  const uploadFileName = ref('');
  const uploadAbortController = ref<AbortController | null>(null);

  const displayEntries = computed(() =>
    searchQuery.value.trim() ? searchResults.value : remoteEntries.value,
  );

  const remoteDirectories = computed(() =>
    displayEntries.value.filter(
      (entry): entry is Extract<RemoteVfsEntry, { type: 'directory' }> =>
        entry.type === 'directory',
    ),
  );
  const remoteItems = computed(() =>
    displayEntries.value.filter(
      (entry): entry is Extract<RemoteVfsEntry, { type: 'file' }> => entry.type === 'file',
    ),
  );
  const pathSegments = computed(() => {
    const parts = remoteCurrentPath.value.split('/').filter(Boolean);
    const segments = [{ label: 'Remote', path: '/' }];
    let acc = '';

    for (const part of parts) {
      acc += `/${part}`;
      segments.push({ label: part, path: acc });
    }

    return segments;
  });
  const selectedRemoteFile = computed(() => {
    if (!selectedEntry.value || selectedEntry.value.source !== 'remote') return null;
    const remoteData = selectedEntry.value.remoteData as RemoteVfsEntry | undefined;
    return remoteData?.type === 'file' ? remoteData : null;
  });
  const selectedRemoteMedia = computed(() => selectedRemoteFile.value?.media?.[0] ?? null);
  const selectedRemoteDisplayName = computed(() => {
    const remoteFile = selectedRemoteFile.value;
    if (remoteFile) return getRemoteEntryDisplayName(remoteFile);
    return selectedEntry.value?.name ?? '';
  });

  function revokePreviewUrl() {
    if (!previewUrl.value) return;
    if (previewUrl.value.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl.value);
    }
    previewUrl.value = '';
    previewPoster.value = '';
  }

  async function loadRemotePath(path: string) {
    const config = remoteFilesConfig.value;
    if (!config) return;

    remoteLoading.value = true;
    try {
      const response = await fetchRemoteVfsList({ config, path });
      remoteCurrentPath.value = path || '/';
      remoteEntries.value = response.items;
    } catch (error) {
      toast.add({
        color: 'error',
        title: t('videoEditor.fileManager.remote.exchange', 'File exchange'),
        description:
          error instanceof Error
            ? error.message
            : t('videoEditor.fileManager.remote.loadFailed', 'Failed to load remote library'),
      });
    } finally {
      remoteLoading.value = false;
    }
  }

  async function openRemoteRoot() {
    await loadRemotePath('/');
  }

  async function selectLocalEntry(entry: FsEntry) {
    selectedEntry.value = entry;
    if (entry.kind === 'file' && entry.source !== 'remote') {
      uiStore.remoteExchangeLocalEntry = entry;
    }
  }

  function selectRemoteItem(entry: RemoteVfsEntry) {
    selectedEntry.value = toRemoteFsEntry(entry);
  }

  function selectRemoteMedia(item: RemoteVfsFileEntry, media: RemoteVfsMedia, mediaIndex: number) {
    selectedEntry.value = createRemoteMediaFsEntry({ item, media, mediaIndex });
  }

  async function navigateToDirectory(entry: Extract<RemoteVfsEntry, { type: 'directory' }>) {
    await loadRemotePath(entry.path || '/');
  }

  function navigateToSegment(path: string) {
    void loadRemotePath(path);
  }

  function navigateUp() {
    const parts = remoteCurrentPath.value.split('/').filter(Boolean);
    if (parts.length === 0) return;
    const next = `/${parts.slice(0, -1).join('/')}`.replace(/\/$/, '') || '/';
    void loadRemotePath(next);
  }

  function resolveRemoteMediaUrl(item: RemoteVfsFileEntry, mediaIndex = 0): string {
    const config = remoteFilesConfig.value;
    if (!config) return '';

    return getRemoteFileDownloadUrl({
      baseUrl: config.baseUrl,
      entry: item,
      mediaIndex,
    });
  }

  function resolveRemotePosterUrl(
    item: RemoteVfsFileEntry,
    media: RemoteVfsMedia,
    mediaIndex: number,
  ): string {
    const config = remoteFilesConfig.value;
    if (!config) return '';

    if (media.posterUrl) {
      if (/^https?:\/\//i.test(media.posterUrl)) return media.posterUrl;
      const base = config.baseUrl.replace(/\/api\/v1\/external\/vfs$/i, '');
      return `${base.replace(/\/+$/, '')}/${media.posterUrl.replace(/^\/+/, '')}`;
    }

    if (media.thumbnailUrl) {
      return getRemoteThumbnailUrl({ baseUrl: config.baseUrl, media });
    }

    return resolveRemoteMediaUrl(item, mediaIndex);
  }

  function getLocalFileFromDragPayload(payload: unknown): FsEntry | null {
    const first = Array.isArray(payload) ? payload[0] : payload;
    const path =
      first && typeof first === 'object' && 'path' in first ? (first.path as string) : '';
    if (!path) return null;

    const entry = fileManager.findEntryByPath(path);
    if (!entry || entry.kind !== 'file' || entry.source === 'remote') return null;

    return entry;
  }

  async function uploadLocalEntry(entry: FsEntry) {
    const config = remoteFilesConfig.value;
    if (!config || entry.kind !== 'file' || entry.source === 'remote' || !entry.path) return;

    const remoteParentPath = remoteCurrentPath.value || '/';
    const remoteDirectory = remoteEntries.value.find(
      (item) => item.type === 'directory' && item.path === remoteParentPath,
    ) as Extract<RemoteVfsEntry, { type: 'directory' }> | undefined;
    const collectionId =
      remoteParentPath === '/'
        ? 'virtual-all'
        : remoteDirectory?.id || remoteParentPath.split('/').filter(Boolean).at(-1);

    if (!collectionId) {
      toast.add({
        color: 'error',
        title: t('videoEditor.fileManager.actions.uploadRemote', 'Upload to remote'),
        description: t(
          'videoEditor.fileManager.remote.collectionUnavailable',
          'Remote collection is not available',
        ),
      });
      return;
    }

    const file = await fileManager.vfs.getFile(entry.path);
    if (!file) {
      toast.add({
        color: 'error',
        title: t('videoEditor.fileManager.actions.uploadRemote', 'Upload to remote'),
        description: t(
          'videoEditor.fileManager.remote.localFileUnavailable',
          'Failed to access local file',
        ),
      });
      return;
    }

    const controller = new AbortController();
    uploadAbortController.value = controller;
    uploadProgress.value = 0;
    uploadFileName.value = file.name;
    uploadProgressOpen.value = true;

    try {
      await uploadFileToRemote({
        config,
        collectionId,
        file,
        signal: controller.signal,
        onProgress: (progress) => {
          uploadProgress.value = progress;
        },
      });
      await loadRemotePath(remoteCurrentPath.value);
    } catch (error) {
      if ((error as Error | undefined)?.name !== 'AbortError') {
        toast.add({
          color: 'error',
          title: t('videoEditor.fileManager.actions.uploadRemote', 'Upload to remote'),
          description:
            error instanceof Error
              ? error.message
              : t('videoEditor.fileManager.remote.uploadFailed', 'Upload failed'),
        });
      }
    } finally {
      uploadAbortController.value = null;
      uploadProgressOpen.value = false;
      uploadProgress.value = 0;
    }
  }

  async function onRemoteDrop(event: DragEvent) {
    libraryDragOver.value = false;
    const moveRaw = event.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
    if (!moveRaw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(moveRaw);
    } catch {
      return;
    }

    const entry = getLocalFileFromDragPayload(parsed);
    if (!entry) return;
    await uploadLocalEntry(entry);
  }

  function onRemoteDragOver(event: DragEvent) {
    const types = event.dataTransfer?.types;
    if (!types?.includes(FILE_MANAGER_MOVE_DRAG_TYPE)) return;
    libraryDragOver.value = true;
    event.dataTransfer!.dropEffect = 'copy';
  }

  function onRemoteDragLeave(event: DragEvent) {
    const currentTarget = event.currentTarget as HTMLElement | null;
    const relatedTarget = event.relatedTarget as Node | null;
    if (!currentTarget?.contains(relatedTarget)) {
      libraryDragOver.value = false;
    }
  }

  function onMediaDragStart(
    event: DragEvent,
    item: RemoteVfsFileEntry,
    media: RemoteVfsMedia,
    mediaIndex: number,
  ) {
    if (!event.dataTransfer) return;

    const remoteEntry = createRemoteMediaFsEntry({ item, media, mediaIndex });
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(REMOTE_FILE_DRAG_TYPE, JSON.stringify(remoteEntry));
    event.dataTransfer.setData(INTERNAL_DRAG_TYPE, '1');
    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        name: remoteEntry.name,
        kind: 'file',
        path: remoteEntry.remotePath,
      }),
    );
    setDraggedFile({
      name: remoteEntry.name,
      kind: 'file',
      path: remoteEntry.remotePath || remoteEntry.path || remoteEntry.name,
    });
  }

  function onMediaDragEnd() {
    clearDraggedFile();
  }

  async function loadPreview(entry: FsEntry | null) {
    revokePreviewUrl();
    previewText.value = '';
    previewKind.value = 'unknown';
    if (!entry || entry.kind !== 'file') return;

    previewLoading.value = true;
    try {
      if (entry.source === 'remote') {
        const remoteFile = entry.remoteData as RemoteVfsFileEntry | undefined;
        const media = remoteFile?.media?.[0];
        if (remoteFile?.text) {
          previewText.value = remoteFile.text;
        }
        if (!media) {
          previewKind.value = remoteFile?.text ? 'text' : 'unknown';
          return;
        }
        previewKind.value = getRemoteMediaKind(media);
        previewUrl.value = resolveRemoteMediaUrl(remoteFile, 0);
        previewPoster.value = resolveRemotePosterUrl(remoteFile, media, 0);
        return;
      }

      if (!entry.path) return;
      const file = await fileManager.vfs.getFile(entry.path);
      if (!file) return;
      const localKind = getMediaTypeFromFilename(file.name);
      if (localKind === 'text') {
        previewKind.value = 'text';
        previewText.value = await file.text();
        return;
      }
      if (localKind === 'video' || localKind === 'audio' || localKind === 'image') {
        previewKind.value = localKind;
        previewUrl.value = URL.createObjectURL(file);
        return;
      }
      previewKind.value = 'document';
    } finally {
      previewLoading.value = false;
    }
  }

  function cancelUpload() {
    uploadAbortController.value?.abort();
  }

  watch(
    () => isOpen.value,
    async (open) => {
      if (!open) {
        selectedEntry.value = null;
        revokePreviewUrl();
        previewText.value = '';
        return;
      }

      await openRemoteRoot();
      if (uiStore.remoteExchangeLocalEntry) {
        selectedEntry.value = uiStore.remoteExchangeLocalEntry;
      }
    },
  );

  watch(
    () => uiStore.remoteExchangeLocalEntry,
    (entry) => {
      if (entry && isOpen.value) {
        selectedEntry.value = entry;
      }
    },
  );

  watch(
    () => selectedEntry.value,
    (entry) => {
      void loadPreview(entry);
    },
    { immediate: true },
  );

  const searchQuery = ref('');
  const searchLoading = ref(false);
  const searchResults = ref<RemoteVfsEntry[]>([]);

  async function searchRemoteLibrary(query: string) {
    const config = remoteFilesConfig.value;
    if (!config) return;

    searchQuery.value = query;
    if (!query.trim()) {
      searchResults.value = [];
      return;
    }

    searchLoading.value = true;
    try {
      const response = await searchRemoteVfs({ config, query });
      searchResults.value = response.items;
    } catch (error) {
      toast.add({
        color: 'error',
        title: t('videoEditor.fileManager.remote.search', 'Search'),
        description: t('videoEditor.fileManager.remote.searchFailed', 'Search failed'),
      });
    } finally {
      searchLoading.value = false;
    }
  }

  async function deleteRemoteEntry(entry: RemoteVfsEntry) {
    const config = remoteFilesConfig.value;
    if (!config) return;

    try {
      if (entry.type === 'directory') {
        await deleteRemoteCollection({ config, id: entry.id });
      } else {
        await deleteRemoteItem({ config, id: entry.id });
      }

      toast.add({
        color: 'success',
        title: t('common.delete', 'Delete'),
        description: t('common.deleteSuccess', 'Success'),
      });

      if (searchQuery.value) {
        await searchRemoteLibrary(searchQuery.value);
      } else {
        await loadRemotePath(remoteCurrentPath.value);
      }
    } catch (error) {
      toast.add({
        color: 'error',
        title: t('common.delete', 'Delete'),
        description: t('common.deleteFailed', 'Failed to delete'),
      });
    }
  }

  async function createRemoteDirectory(name: string) {
    const config = remoteFilesConfig.value;
    if (!config) return;

    try {
      const parentId =
        remoteCurrentPath.value === '/' ? undefined : remoteEntries.value[0]?.parentId; // This is a bit flawed but works if we are inside a folder
      // Actually better way is to track current folder ID, but list response doesn't give it directly.
      // Remote entries in a folder should have the same parentId.
      let actualParentId = undefined;
      if (remoteCurrentPath.value !== '/') {
        actualParentId =
          remoteEntries.value.find((e) => e.path === remoteCurrentPath.value)?.id ||
          remoteEntries.value[0]?.parentId;
      }

      await createRemoteCollection({ config, name, parentId: actualParentId });
      await loadRemotePath(remoteCurrentPath.value);

      toast.add({
        color: 'success',
        title: t('videoEditor.fileManager.actions.createFolder', 'Create folder'),
        description: t('common.success', 'Success'),
      });
    } catch (error) {
      toast.add({
        color: 'error',
        title: t('videoEditor.fileManager.actions.createFolder', 'Create folder'),
        description: t('common.failed', 'Failed'),
      });
    }
  }

  onBeforeUnmount(() => {
    revokePreviewUrl();
  });

  return {
    isOpen,
    remoteFilesConfig,
    remoteCurrentPath,
    remoteEntries,
    searchResults,
    searchQuery,
    searchLoading,
    remoteLoading,
    selectedEntry,
    previewUrl,
    previewPoster,
    previewText,
    previewKind,
    previewLoading,
    libraryDragOver,
    uploadProgressOpen,
    uploadProgress,
    uploadFileName,
    remoteDirectories,
    remoteItems,
    pathSegments,
    selectedRemoteFile,
    selectedRemoteMedia,
    selectedRemoteDisplayName,
    openRemoteRoot,
    selectLocalEntry,
    selectRemoteItem,
    selectRemoteMedia,
    navigateToDirectory,
    navigateToSegment,
    navigateUp,
    resolveRemotePosterUrl,
    getRemoteEntryDisplayName,
    getRemoteMediaKind,
    onRemoteDrop,
    onRemoteDragOver,
    onRemoteDragLeave,
    onMediaDragStart,
    onMediaDragEnd,
    cancelUpload,
    searchRemoteLibrary,
    deleteRemoteEntry,
    createRemoteDirectory,
  };
}
