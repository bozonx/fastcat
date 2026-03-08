<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import AppModal from '~/components/ui/AppModal.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import RemoteTransferProgressModal from '~/components/file-manager/RemoteTransferProgressModal.vue';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useFileManager } from '~/composables/fileManager/useFileManager';
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
  createRemoteMediaFsEntry,
  fetchRemoteVfsList,
  getRemoteEntryDisplayName,
  getRemoteFileDownloadUrl,
  getRemoteThumbnailUrl,
  getRemoteMediaKind,
  toRemoteFsEntry,
  uploadFileToRemote,
} from '~/utils/remote-vfs';
import type { RemoteVfsEntry, RemoteVfsFileEntry, RemoteVfsMedia } from '~/types/remote-vfs';

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
    granPublicadorBaseUrl:
      typeof runtimeConfig.public.gpanPublicadorBaseUrl === 'string'
        ? runtimeConfig.public.gpanPublicadorBaseUrl
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

const remoteDirectories = computed(() =>
  remoteEntries.value.filter(
    (entry): entry is Extract<RemoteVfsEntry, { type: 'directory' }> => entry.type === 'directory',
  ),
);
const remoteItems = computed(() =>
  remoteEntries.value.filter(
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
    const response = await fetchRemoteVfsList({
      config,
      path,
    });
    remoteCurrentPath.value = path || '/';
    remoteEntries.value = response.items;
  } catch (error) {
    toast.add({
      color: 'error',
      title: t('videoEditor.fileManager.remote.exchange', 'File exchange'),
      description: error instanceof Error ? error.message : 'Failed to load remote library',
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
    return getRemoteThumbnailUrl({
      baseUrl: config.baseUrl,
      media,
    });
  }

  return resolveRemoteMediaUrl(item, mediaIndex);
}

function getLocalFileFromDragPayload(payload: unknown): FsEntry | null {
  const first = Array.isArray(payload) ? payload[0] : payload;
  const path = first && typeof first === 'object' && 'path' in first ? (first.path as string) : '';
  if (!path) return null;
  const entry = fileManager.findEntryByPath(path);
  if (!entry || entry.kind !== 'file' || entry.source === 'remote') return null;
  return entry;
}

async function uploadLocalEntry(entry: FsEntry) {
  const config = remoteFilesConfig.value;
  if (!config || entry.kind !== 'file' || entry.source === 'remote') return;

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
      description: 'Remote collection is not available',
    });
    return;
  }

  const file = await (entry.handle as FileSystemFileHandle).getFile();
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
        description: error instanceof Error ? error.message : 'Upload failed',
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

    const file = await (entry.handle as FileSystemFileHandle).getFile();
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

onBeforeUnmount(() => {
  revokePreviewUrl();
});
</script>

<template>
  <AppModal
    v-model:open="isOpen"
    :title="t('videoEditor.fileManager.remote.exchange', 'File exchange')"
    :description="
      t(
        'videoEditor.fileManager.remote.exchangeDescription',
        'Exchange files between the local project and the remote content library',
      )
    "
    :ui="{
      content: 'max-w-[96vw] w-[96vw] h-[92vh]',
      body: '!p-0 !overflow-hidden',
      footer: 'hidden',
    }"
  >
    <div class="flex h-full min-h-0 flex-col">
      <div
        v-if="!remoteFilesConfig"
        class="flex h-full items-center justify-center p-8 text-center text-sm text-ui-text-muted"
      >
        {{ t('videoEditor.settings.integrationInactive', 'Not configured') }}
      </div>

      <div
        v-else
        class="grid h-full min-h-0 grid-cols-[minmax(300px,1fr)_minmax(480px,1.35fr)_minmax(320px,0.95fr)] divide-x divide-ui-border"
      >
        <div class="min-h-0 overflow-hidden bg-ui-bg-elevated">
          <FileManagerPanel class="h-full" @select="selectLocalEntry" />
        </div>

        <div class="flex min-h-0 flex-col bg-ui-bg">
          <div class="flex items-center gap-2 border-b border-ui-border px-4 py-3">
            <div class="flex min-w-0 items-center gap-1 overflow-hidden text-xs text-ui-text-muted">
              <button
                v-for="segment in pathSegments"
                :key="segment.path"
                class="truncate rounded px-1.5 py-0.5 hover:bg-ui-bg-elevated hover:text-ui-text"
                @click="navigateToSegment(segment.path)"
              >
                {{ segment.label }}
              </button>
            </div>
            <div class="ml-auto flex items-center gap-2">
              <UButton
                icon="i-heroicons-arrow-up"
                variant="ghost"
                color="neutral"
                size="xs"
                :disabled="remoteCurrentPath === '/'"
                @click="navigateUp"
              />
              <UButton
                icon="i-heroicons-arrow-path"
                variant="ghost"
                color="neutral"
                size="xs"
                :loading="remoteLoading"
                @click="openRemoteRoot"
              />
            </div>
          </div>

          <div
            class="relative flex-1 overflow-auto p-4"
            :class="{ 'bg-primary-500/5': libraryDragOver }"
            @dragover.prevent="onRemoteDragOver"
            @dragleave.prevent="onRemoteDragLeave"
            @drop.prevent="onRemoteDrop"
          >
            <div
              v-if="libraryDragOver"
              class="pointer-events-none absolute inset-4 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-primary-500/50 bg-primary-500/10 text-sm font-medium text-primary-400"
            >
              {{ t('videoEditor.fileManager.actions.uploadRemote', 'Upload to remote') }}
            </div>

            <div v-if="remoteLoading" class="flex h-full items-center justify-center">
              <UIcon
                name="i-heroicons-arrow-path"
                class="h-6 w-6 animate-spin text-ui-text-muted"
              />
            </div>

            <div v-else class="flex min-h-full flex-col gap-4">
              <div
                v-if="remoteDirectories.length > 0"
                class="grid grid-cols-2 gap-3 xl:grid-cols-3"
              >
                <button
                  v-for="directory in remoteDirectories"
                  :key="directory.id"
                  class="flex min-h-28 flex-col rounded-xl border border-ui-border bg-ui-bg-elevated p-4 text-left transition hover:border-primary-500/40 hover:bg-ui-bg-hover"
                  @click="navigateToDirectory(directory)"
                >
                  <UIcon name="i-heroicons-folder" class="mb-3 h-7 w-7 text-amber-400" />
                  <div class="truncate text-sm font-medium text-ui-text">
                    {{ getRemoteEntryDisplayName(directory) }}
                  </div>
                  <div class="mt-1 text-xs text-ui-text-muted">
                    {{ directory.itemsCount ?? 0 }}
                  </div>
                </button>
              </div>

              <div
                v-if="remoteItems.length === 0"
                class="flex flex-1 items-center justify-center rounded-xl border border-dashed border-ui-border p-8 text-sm text-ui-text-muted"
              >
                {{ t('common.empty', 'Folder is empty') }}
              </div>

              <div v-else class="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                <div
                  v-for="item in remoteItems"
                  :key="item.id"
                  class="rounded-2xl border p-4 transition"
                  :class="
                    selectedRemoteFile?.id === item.id
                      ? 'border-primary-500 bg-primary-500/5'
                      : 'border-ui-border bg-ui-bg-elevated hover:border-primary-500/30'
                  "
                >
                  <button class="mb-3 block w-full text-left" @click="selectRemoteItem(item)">
                    <div class="truncate text-sm font-semibold text-ui-text">
                      {{ getRemoteEntryDisplayName(item) }}
                    </div>
                    <div class="mt-1 text-xs text-ui-text-muted">
                      {{ item.media?.length ?? 0 }} media
                    </div>
                  </button>

                  <div class="overflow-x-auto pb-1">
                    <div class="flex gap-3">
                      <button
                        v-for="(media, mediaIndex) in item.media ?? []"
                        :key="`${item.id}-${media.id}-${mediaIndex}`"
                        draggable="true"
                        class="flex w-32 shrink-0 flex-col gap-2 rounded-xl border border-ui-border bg-ui-bg p-2 text-left transition hover:border-primary-500/40"
                        @click="selectRemoteMedia(item, media, mediaIndex)"
                        @dragstart="onMediaDragStart($event, item, media, mediaIndex)"
                        @dragend="onMediaDragEnd"
                      >
                        <div
                          class="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-ui-bg-elevated"
                        >
                          <img
                            v-if="
                              getRemoteMediaKind(media) === 'image' ||
                              getRemoteMediaKind(media) === 'video'
                            "
                            :src="resolveRemotePosterUrl(item, media, mediaIndex)"
                            class="h-full w-full object-cover"
                            alt=""
                          />
                          <div
                            v-else-if="getRemoteMediaKind(media) === 'audio'"
                            class="flex h-full w-full flex-col items-center justify-center gap-2 text-ui-text-muted transition group-hover:bg-ui-bg-hover"
                          >
                            <UIcon name="i-heroicons-musical-note" class="h-8 w-8" />
                            <span class="text-[10px] uppercase">Audio</span>
                          </div>
                          <div
                            v-else-if="getRemoteMediaKind(media) === 'document'"
                            class="flex h-full w-full flex-col items-center justify-center gap-2 text-ui-text-muted"
                          >
                            <UIcon name="i-heroicons-document-text" class="h-8 w-8" />
                            <span class="text-[10px] uppercase">Document</span>
                          </div>
                          <div
                            v-else
                            class="flex h-full w-full flex-col items-center justify-center gap-2 text-ui-text-muted"
                          >
                            <UIcon name="i-heroicons-film" class="h-8 w-8" />
                            <span class="text-[10px] uppercase">
                              {{ getRemoteMediaKind(media) }}
                            </span>
                          </div>
                        </div>
                        <div class="line-clamp-2 text-[11px] leading-4 text-ui-text">
                          {{
                            media.title ||
                            media.name ||
                            `${getRemoteEntryDisplayName(item)} ${mediaIndex + 1}`
                          }}
                        </div>
                      </button>

                      <button
                        v-if="item.text"
                        class="flex w-32 shrink-0 flex-col gap-2 rounded-xl border border-ui-border bg-ui-bg p-2 text-left transition hover:border-primary-500/40"
                        @click="selectRemoteItem(item)"
                      >
                        <div
                          class="flex aspect-square items-center justify-center rounded-lg bg-ui-bg-elevated p-2 text-[10px] leading-4 text-ui-text-muted"
                        >
                          <div class="line-clamp-6 w-full text-left">
                            {{ item.text }}
                          </div>
                        </div>
                        <div class="text-[11px] text-ui-text">Text</div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex min-h-0 flex-col bg-ui-bg-elevated">
          <div class="border-b border-ui-border px-4 py-3 text-sm font-medium text-ui-text">
            {{ t('common.preview', 'Preview') }}
          </div>
          <div class="flex-1 overflow-auto p-4">
            <div
              v-if="!selectedEntry"
              class="flex h-full items-center justify-center text-sm text-ui-text-muted"
            >
              {{ t('granVideoEditor.preview.noSelection', 'No item selected') }}
            </div>

            <div v-else class="flex flex-col gap-4">
              <div class="rounded-xl border border-ui-border bg-ui-bg p-3">
                <div class="text-sm font-semibold text-ui-text">
                  {{ selectedEntry.name }}
                </div>
                <div class="mt-1 break-all text-xs text-ui-text-muted">
                  {{ selectedEntry.path || '/' }}
                </div>
                <div class="mt-2 text-xs text-ui-text-muted">
                  {{
                    selectedEntry.source === 'remote'
                      ? 'Remote content library'
                      : 'Local project files'
                  }}
                </div>
              </div>

              <div
                v-if="previewLoading"
                class="flex min-h-60 items-center justify-center rounded-xl border border-ui-border bg-ui-bg"
              >
                <UIcon
                  name="i-heroicons-arrow-path"
                  class="h-6 w-6 animate-spin text-ui-text-muted"
                />
              </div>

              <div
                v-else-if="previewKind === 'image' && previewUrl"
                class="overflow-hidden rounded-xl border border-ui-border bg-ui-bg"
              >
                <img :src="previewUrl" class="max-h-112 w-full object-contain" alt="" />
              </div>

              <div
                v-else-if="previewKind === 'video' && previewUrl"
                class="overflow-hidden rounded-xl border border-ui-border bg-black"
              >
                <video
                  :src="previewUrl"
                  :poster="previewPoster"
                  controls
                  class="max-h-112 w-full"
                />
              </div>

              <div
                v-else-if="previewKind === 'audio' && previewUrl"
                class="rounded-xl border border-ui-border bg-ui-bg p-4"
              >
                <audio :src="previewUrl" controls class="w-full" />
              </div>

              <div
                v-else-if="previewKind === 'text'"
                class="rounded-xl border border-ui-border bg-ui-bg p-4 text-xs leading-5 text-ui-text"
              >
                <pre class="wrap-break-word whitespace-pre-wrap font-mono">{{ previewText }}</pre>
              </div>

              <div
                v-else
                class="flex min-h-60 flex-col items-center justify-center rounded-xl border border-ui-border bg-ui-bg text-ui-text-muted"
              >
                <UIcon name="i-heroicons-document" class="mb-3 h-10 w-10" />
                <div class="text-sm">
                  {{
                    previewKind === 'document'
                      ? 'Document preview is not available'
                      : 'Preview is not available'
                  }}
                </div>
              </div>

              <div
                v-if="selectedRemoteFile"
                class="rounded-xl border border-ui-border bg-ui-bg p-4"
              >
                <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-ui-text-muted">
                  Remote item
                </div>
                <div class="space-y-2 text-xs text-ui-text">
                  <div>
                    <span class="text-ui-text-muted">Title:</span>
                    {{ selectedRemoteDisplayName }}
                  </div>
                  <div v-if="selectedRemoteFile.tags?.length">
                    <span class="text-ui-text-muted">Tags:</span>
                    {{ selectedRemoteFile.tags.join(', ') }}
                  </div>
                  <div v-if="selectedRemoteMedia?.mimeType">
                    <span class="text-ui-text-muted">Type:</span>
                    {{ selectedRemoteMedia.mimeType }}
                  </div>
                  <div v-if="selectedRemoteMedia?.size">
                    <span class="text-ui-text-muted">Size:</span>
                    {{ selectedRemoteMedia.size }} B
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer />
  </AppModal>

  <RemoteTransferProgressModal
    v-model:open="uploadProgressOpen"
    :title="t('videoEditor.fileManager.actions.uploadRemote', 'Upload to remote')"
    :description="t('videoEditor.fileManager.actions.uploadFiles', 'Upload files')"
    :progress="uploadProgress"
    :file-name="uploadFileName"
    @cancel="cancelUpload"
  />
</template>
