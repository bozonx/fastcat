<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import type { TimelineClipItem } from '~/timeline/types';
import yaml from 'js-yaml';
import RenameModal from '~/components/common/RenameModal.vue';
import EffectsEditor from '~/components/common/EffectsEditor.vue';
import type { TimelineTrack } from '~/timeline/types';

defineOptions({
  name: 'PreviewPanel',
});

const { t } = useI18n();
const uiStore = useUiStore();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const proxyStore = useProxyStore();

const currentUrl = ref<string | null>(null);
const mediaType = ref<'image' | 'video' | 'audio' | 'text' | 'unknown' | null>(null);
const textContent = ref<string>('');
const previewMode = ref<'original' | 'proxy'>('original');

const fileInfo = ref<{
  name: string;
  kind: string;
  size?: number;
  lastModified?: number;
  metadata?: unknown;
} | null>(null);

const selectedClip = computed<TimelineClipItem | null>(() => {
  if (timelineStore.selectedItemIds.length !== 1) return null;
  const id = timelineStore.selectedItemIds[0];
  for (const track of timelineStore.timelineDoc?.tracks ?? []) {
    const item = track.items.find((it) => it.id === id);
    if (item && item.kind === 'clip') {
      return item as TimelineClipItem;
    }
  }
  return null;
});

const selectedTrack = computed<TimelineTrack | null>(() => {
  const trackId = timelineStore.selectedTrackId;
  if (!trackId) return null;
  const tracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  return tracks.find((t) => t.id === trackId) ?? null;
});

const isRenameModalOpen = ref(false);

function handleUpdateOpacity(val: number | undefined) {
  if (!selectedClip.value) return;
  const safe = typeof val === 'number' && Number.isFinite(val) ? val : 1;
  timelineStore.updateClipProperties(selectedClip.value.trackId, selectedClip.value.id, {
    opacity: safe,
  });
}

function handleUpdateClipEffects(effects: any[]) {
  if (!selectedClip.value) return;
  timelineStore.updateClipProperties(selectedClip.value.trackId, selectedClip.value.id, {
    effects: effects as any,
  });
}

function handleUpdateTrackEffects(effects: any[]) {
  if (!selectedTrack.value) return;
  timelineStore.updateTrackProperties(selectedTrack.value.id, { effects: effects as any });
}

const displayMode = computed<'clip' | 'track' | 'file' | 'empty'>(() => {
  if (selectedClip.value) return 'clip';
  if (selectedTrack.value) return 'track';
  if (uiStore.selectedFsEntry && uiStore.selectedFsEntry.kind === 'file') return 'file';
  return 'empty';
});

const hasProxy = computed(() => {
  if (displayMode.value !== 'file' || !uiStore.selectedFsEntry || !uiStore.selectedFsEntry.path)
    return false;
  return proxyStore.existingProxies.has(uiStore.selectedFsEntry.path);
});

watch(hasProxy, (val) => {
  if (!val && previewMode.value === 'proxy') {
    previewMode.value = 'original';
  }
});

async function loadPreviewMedia() {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
    currentUrl.value = null;
  }

  const entry = uiStore.selectedFsEntry;
  if (!entry || entry.kind !== 'file') return;

  try {
    let fileToPlay: File;

    if (previewMode.value === 'proxy' && hasProxy.value && entry.path) {
      const proxyFile = await proxyStore.getProxyFile(entry.path);
      if (proxyFile) {
        fileToPlay = proxyFile;
      } else {
        fileToPlay = await (entry.handle as FileSystemFileHandle).getFile();
      }
    } else {
      fileToPlay = await (entry.handle as FileSystemFileHandle).getFile();
    }

    if (mediaType.value === 'image' || mediaType.value === 'video' || mediaType.value === 'audio') {
      currentUrl.value = URL.createObjectURL(fileToPlay);
    }
  } catch (e) {
    console.error('Failed to load preview media:', e);
  }
}

watch(previewMode, () => {
  void loadPreviewMedia();
});

watch(
  () => uiStore.selectedFsEntry,
  async (entry) => {
    // Revoke old URL
    if (currentUrl.value) {
      URL.revokeObjectURL(currentUrl.value);
      currentUrl.value = null;
    }
    mediaType.value = null;
    textContent.value = '';
    fileInfo.value = null;
    previewMode.value = 'original';

    if (!entry || entry.kind !== 'file') return;

    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();

      fileInfo.value = {
        name: file.name,
        kind: 'file',
        size: file.size,
        lastModified: file.lastModified,
        metadata: entry.path
          ? await mediaStore.getOrFetchMetadata(entry.handle as FileSystemFileHandle, entry.path, {
              forceRefresh: true,
            })
          : undefined,
      };

      const ext = entry.name.split('.').pop()?.toLowerCase();
      const textExtensions = ['txt', 'md', 'json', 'yaml', 'yml'];

      if (file.type.startsWith('image/')) {
        mediaType.value = 'image';
      } else if (file.type.startsWith('video/')) {
        mediaType.value = 'video';
      } else if (file.type.startsWith('audio/')) {
        mediaType.value = 'audio';
      } else if (textExtensions.includes(ext || '') || file.type.startsWith('text/')) {
        mediaType.value = 'text';
        // limit text read to first 1MB
        const textSlice = file.slice(0, 1024 * 1024);
        textContent.value = await textSlice.text();
        if (file.size > 1024 * 1024) {
          textContent.value += '\n... (truncated)';
        }
      } else {
        mediaType.value = 'unknown';
      }

      if (
        mediaType.value === 'image' ||
        mediaType.value === 'video' ||
        mediaType.value === 'audio'
      ) {
        await loadPreviewMedia();
      }
    } catch (e) {
      console.error('Failed to preview file:', e);
    }
  },
);

onUnmounted(() => {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
  }
});

function formatMegabytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(decimals)} MB`;
}

function formatTime(us: number): string {
  if (!us) return '0.00s';
  return (us / 1_000_000).toFixed(2) + 's';
}

const metadataYaml = computed(() => {
  if (!fileInfo.value?.metadata) return null;
  try {
    return yaml.dump(fileInfo.value.metadata, { indent: 2 });
  } catch {
    return String(fileInfo.value.metadata);
  }
});

function handleDeleteClip() {
  if (selectedClip.value) {
    timelineStore.deleteSelectedItems(selectedClip.value.trackId);
  }
}

function handleRenameClip(newName: string) {
  if (selectedClip.value && newName.trim()) {
    timelineStore.renameItem(selectedClip.value.trackId, selectedClip.value.id, newName.trim());
  }
}

const isUnknown = computed(() => mediaType.value === 'unknown');
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0">
    <!-- Header -->
    <div
      class="flex items-center justify-between px-3 py-2 border-b border-ui-border shrink-0 h-10"
    >
      <div class="flex items-center overflow-hidden min-w-0">
        <span class="text-xs font-semibold text-ui-text-muted uppercase tracking-wider shrink-0">
          {{ t('granVideoEditor.preview.title', 'Properties') }}
        </span>
        <span v-if="displayMode === 'clip'" class="ml-2 text-xs text-gray-500 font-mono truncate">
          {{ selectedClip?.name }}
        </span>
        <span
          v-else-if="displayMode === 'file' && uiStore.selectedFsEntry"
          class="ml-2 text-xs text-gray-500 font-mono truncate"
        >
          {{ uiStore.selectedFsEntry.name }}
        </span>
      </div>
      <div v-if="displayMode === 'clip'" class="flex gap-1 shrink-0 ml-2">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-pencil"
          @click="isRenameModalOpen = true"
        />
        <UButton
          size="xs"
          variant="ghost"
          color="red"
          icon="i-heroicons-trash"
          @click="handleDeleteClip"
        />
      </div>
      <div v-else-if="displayMode === 'file' && hasProxy" class="flex gap-1 shrink-0 ml-2">
        <UFieldGroup size="xs">
          <UButton
            :color="previewMode === 'original' ? 'primary' : 'neutral'"
            :variant="previewMode === 'original' ? 'soft' : 'ghost'"
            :label="t('videoEditor.fileManager.preview.original', 'Original')"
            @click="previewMode = 'original'"
          />
          <UButton
            :color="previewMode === 'proxy' ? 'primary' : 'neutral'"
            :variant="previewMode === 'proxy' ? 'soft' : 'ghost'"
            :label="t('videoEditor.fileManager.preview.proxy', 'Proxy')"
            @click="previewMode = 'proxy'"
          />
        </UFieldGroup>
      </div>
    </div>

    <!-- Content Area -->
    <div class="flex-1 min-h-0 bg-black relative">
      <div class="absolute inset-0 overflow-auto">
        <div class="flex flex-col min-w-62.5 p-4 items-start w-full">
          <div
            v-if="displayMode === 'empty'"
            class="w-full flex flex-col items-center justify-center gap-3 text-gray-700 min-h-50"
          >
            <UIcon name="i-heroicons-eye" class="w-16 h-16" />
            <p class="text-sm">
              {{ t('granVideoEditor.preview.noSelection', 'No item selected') }}
            </p>
          </div>

          <!-- Clip Properties -->
          <div
            v-else-if="displayMode === 'clip' && selectedClip"
            class="w-full flex flex-col gap-4 text-white"
          >
            <div class="flex items-center gap-3">
              <UIcon
                :name="
                  selectedClip.trackId.startsWith('v')
                    ? 'i-heroicons-video-camera'
                    : 'i-heroicons-musical-note'
                "
                class="w-10 h-10 shrink-0"
                :class="selectedClip.trackId.startsWith('v') ? 'text-indigo-400' : 'text-teal-400'"
              />
              <div class="min-w-0">
                <h3 class="font-medium text-lg truncate">{{ selectedClip.name }}</h3>
                <span class="text-xs text-gray-400 uppercase">
                  {{
                    selectedClip.trackId.startsWith('v')
                      ? t('common.video', 'Video Clip')
                      : t('common.audio', 'Audio Clip')
                  }}
                </span>
              </div>
            </div>

            <div class="space-y-2 mt-4 bg-gray-900 p-4 rounded border border-gray-800 text-sm">
              <div
                v-if="selectedClip.clipType === 'media'"
                class="flex flex-col gap-1 border-b border-gray-800 pb-2"
              >
                <span class="text-gray-500">{{ t('common.source', 'Source File') }}</span>
                <span class="font-medium break-all">{{ selectedClip.source.path }}</span>
              </div>
              <div
                v-else-if="selectedClip.clipType === 'background'"
                class="flex flex-col gap-1 border-b border-gray-800 pb-2"
              >
                <span class="text-gray-500">{{ t('common.color', 'Color') }}</span>
                <span class="font-medium break-all">{{ selectedClip.backgroundColor }}</span>
              </div>
              <div class="flex flex-col gap-1 border-b border-gray-800 pb-2">
                <span class="text-gray-500">{{ t('common.start', 'Start Time') }}</span>
                <span class="font-mono">{{ formatTime(selectedClip.timelineRange.startUs) }}</span>
              </div>
              <div class="flex flex-col gap-1 pb-2">
                <span class="text-gray-500">{{ t('common.duration', 'Duration') }}</span>
                <span class="font-mono">{{
                  formatTime(selectedClip.timelineRange.durationUs)
                }}</span>
              </div>
            </div>

            <!-- Transparency (Opacity) -->
            <div
              v-if="selectedClip.clipType !== 'adjustment'"
              class="space-y-3 mt-2 bg-gray-900 p-4 rounded border border-gray-800 text-sm"
            >
              <div class="flex items-center justify-between">
                <span class="font-medium text-gray-300">Прозрачность</span>
                <span class="text-xs font-mono text-gray-500">{{ Math.round((selectedClip.opacity ?? 1) * 100) }}%</span>
              </div>
              <USlider
                :model-value="selectedClip.opacity ?? 1"
                :min="0"
                :max="1"
                :step="0.01"
                @update:model-value="handleUpdateOpacity"
              />
            </div>

            <EffectsEditor
              :effects="selectedClip.effects"
              :title="t('granVideoEditor.effects.clipTitle', 'Clip effects')"
              :add-label="t('granVideoEditor.effects.add', 'Add')"
              :empty-label="t('granVideoEditor.effects.empty', 'No effects')"
              @update:effects="handleUpdateClipEffects"
            />
          </div>

          <div v-else-if="displayMode === 'track' && selectedTrack" class="w-full flex flex-col gap-4">
            <div class="flex items-center gap-3">
              <UIcon
                :name="selectedTrack.kind === 'video' ? 'i-heroicons-video-camera' : 'i-heroicons-musical-note'"
                class="w-10 h-10 shrink-0"
                :class="selectedTrack.kind === 'video' ? 'text-indigo-400' : 'text-teal-400'"
              />
              <div class="min-w-0">
                <h3 class="font-medium text-lg truncate">{{ selectedTrack.name }}</h3>
                <span class="text-xs text-gray-400 uppercase">
                  {{ selectedTrack.kind === 'video' ? t('common.video', 'Video Track') : t('common.audio', 'Audio Track') }}
                </span>
              </div>
            </div>

            <div class="space-y-2 mt-2 bg-gray-900 p-4 rounded border border-gray-800 text-sm">
              <div class="flex flex-col gap-1">
                <span class="text-gray-500">{{ t('common.name', 'Name') }}</span>
                <span class="font-medium break-all">{{ selectedTrack.name }}</span>
              </div>
            </div>

            <EffectsEditor
              :effects="selectedTrack.effects"
              :title="t('granVideoEditor.effects.trackTitle', 'Track effects')"
              :add-label="t('granVideoEditor.effects.add', 'Add')"
              :empty-label="t('granVideoEditor.effects.empty', 'No effects')"
              @update:effects="handleUpdateTrackEffects"
            />
          </div>

          <!-- File Preview & Properties -->
          <div v-else-if="displayMode === 'file'" class="w-full flex flex-col gap-4">
            <!-- Preview Box -->
            <div
              class="w-full bg-black rounded border border-gray-800 flex items-center justify-center min-h-50 overflow-hidden shrink-0"
            >
              <div v-if="isUnknown" class="flex flex-col items-center gap-3 text-gray-700 p-8">
                <UIcon name="i-heroicons-document" class="w-16 h-16" />
                <p class="text-sm text-center">
                  {{
                    t(
                      'granVideoEditor.preview.unsupported',
                      'Unsupported file format for visual preview',
                    )
                  }}
                </p>
              </div>

              <template v-else-if="currentUrl">
                <img
                  v-if="mediaType === 'image'"
                  :src="currentUrl"
                  class="max-w-full max-h-64 object-contain"
                />
                <MediaPlayer
                  v-else-if="mediaType === 'video' || mediaType === 'audio'"
                  :src="currentUrl"
                  :type="mediaType"
                  class="w-full h-64"
                />
              </template>

              <pre
                v-else-if="mediaType === 'text'"
                class="w-full max-h-64 overflow-auto p-4 text-xs font-mono text-gray-300 whitespace-pre-wrap"
                >{{ textContent }}</pre
              >
            </div>

            <!-- File Info -->
            <div
              v-if="fileInfo"
              class="space-y-2 bg-gray-900 p-4 rounded border border-gray-800 text-sm w-full"
            >
              <div class="flex flex-col gap-1 border-b border-gray-800 pb-2">
                <span class="text-gray-500">{{ t('common.name', 'Name') }}</span>
                <span class="font-medium text-white break-all">{{ fileInfo.name }}</span>
              </div>
              <div
                v-if="fileInfo.size !== undefined"
                class="flex flex-col gap-1 border-b border-gray-800 pb-2"
              >
                <span class="text-gray-500">{{ t('common.size', 'Size') }}</span>
                <span class="font-medium text-white">{{ formatMegabytes(fileInfo.size) }}</span>
              </div>
              <div
                v-if="fileInfo.lastModified"
                class="flex flex-col gap-1 pb-2"
                :class="{ 'border-b border-gray-800': metadataYaml }"
              >
                <span class="text-gray-500">{{ t('common.modified', 'Modified') }}</span>
                <span class="font-medium text-white">{{
                  new Date(fileInfo.lastModified).toLocaleString()
                }}</span>
              </div>
              <div v-if="metadataYaml" class="flex flex-col gap-1 pt-2">
                <span class="text-gray-500">{{
                  t('videoEditor.fileManager.info.metadata', 'Metadata')
                }}</span>
                <pre
                  class="bg-gray-950 p-2 rounded text-[10px] font-mono overflow-auto max-h-40 whitespace-pre text-gray-400"
                  >{{ metadataYaml }}</pre
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <RenameModal
      v-model:open="isRenameModalOpen"
      :initial-name="selectedClip?.name"
      @rename="handleRenameClip"
    />
  </div>
</template>
