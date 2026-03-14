<script setup lang="ts">
import AppModal from '~/components/ui/AppModal.vue';
import FileManagerPanel from '~/components/file-manager/FileManagerPanel.vue';
import RemoteTransferProgressModal from '~/components/file-manager/RemoteTransferProgressModal.vue';
import { useRemoteExchange } from '~/composables/fileManager/useRemoteExchange';

const { t } = useI18n();
const {
  isOpen,
  remoteFilesConfig,
  remoteCurrentPath,
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
} = useRemoteExchange();
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
              {{ t('fastcat.preview.noSelection', 'No item selected') }}
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
