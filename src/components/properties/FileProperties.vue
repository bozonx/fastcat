<script setup lang="ts">
import { ref, watch, onUnmounted, computed } from 'vue';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import yaml from 'js-yaml';
import MediaPlayer from '~/components/MediaPlayer.vue';
import { formatBytes, formatBitrate, formatDurationSeconds } from '~/utils/format';
import { computeDirectorySize } from '~/utils/fs';
import { TEXT_EXTENSIONS, VIDEO_EXTENSIONS } from '~/utils/media-types';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { parseTimelineFromOtio } from '~/timeline/otioSerializer';
import type { TimelineDocument } from '~/timeline/types';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertySection from '~/components/properties/PropertySection.vue';

const props = defineProps<{
  selectedFsEntry: any;
  previewMode: 'original' | 'proxy';
  hasProxy: boolean;
}>();

const emit = defineEmits<{
  'update:previewMode': [val: 'original' | 'proxy'];
}>();

const { t } = useI18n();
const mediaStore = useMediaStore();
const proxyStore = useProxyStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();

const currentUrl = ref<string | null>(null);
const mediaType = ref<'image' | 'video' | 'audio' | 'text' | 'unknown' | null>(null);
const textContent = ref<string>('');
const isMetaExpanded = ref(false);

type EntryPreviewInfo = {
  kind: 'file' | 'directory';
  name: string;
  path?: string;
  size?: number;
  lastModified?: number;
  mimeType?: string;
  container?: string;
  metadata?: unknown;
  ext?: string;
};

const fileInfo = ref<EntryPreviewInfo | null>(null);

const uploadInputRef = ref<HTMLInputElement | null>(null);

function triggerDirectoryUpload() {
  uploadInputRef.value?.click();
}

async function onDirectoryFileSelect(e: Event) {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory') return;

  const input = e.target as HTMLInputElement;
  const files = input.files ? Array.from(input.files) : [];
  input.value = '';
  if (!files || files.length === 0) return;

  const { useFileManager } = await import('~/composables/fileManager/useFileManager');
  const fm = useFileManager();
  await fm.handleFiles(files, entry.handle as FileSystemDirectoryHandle, entry.path);
  await fm.loadProjectDirectory();
}

const isUnknown = computed(() => mediaType.value === 'unknown');

const selectedPath = computed<string | null>(() => {
  const entry = props.selectedFsEntry;
  return typeof entry?.path === 'string' && entry.path.length > 0 ? entry.path : null;
});

const isHidden = computed(() => {
  const entry = props.selectedFsEntry;
  const name = typeof entry?.name === 'string' ? entry.name : '';
  return name.startsWith('.');
});

const ext = computed(() => {
  const entry = props.selectedFsEntry;
  const name = typeof entry?.name === 'string' ? entry.name : '';
  const value = name.split('.').pop()?.toLowerCase() ?? '';
  return value && value !== name.toLowerCase() ? value : value;
});

const isOtio = computed(() => ext.value === 'otio');

const timelineDocSummary = ref<{
  durationUs: number;
  videoTracks: number;
  audioTracks: number;
  clips: number;
} | null>(null);

function computeTimelineSummary(doc: TimelineDocument) {
  const durationUs = selectTimelineDurationUs(doc);
  const videoTracks = doc.tracks.filter((t) => t.kind === 'video').length;
  const audioTracks = doc.tracks.filter((t) => t.kind === 'audio').length;
  const clips = doc.tracks.reduce(
    (acc, t) =>
      acc +
      t.items.filter((it) => it.kind === 'clip').length,
    0,
  );
  return { durationUs, videoTracks, audioTracks, clips };
}

function formatAudioChannels(channels: number | undefined) {
  if (!channels || channels <= 0) return '-';
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels}ch`;
}

const timelinesUsingSelectedFile = computed(() => {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'file' || !entry.path) return [];
  return timelineMediaUsageStore.mediaPathToTimelines[entry.path] ?? [];
});

async function openTimelineFromUsage(path: string) {
  await projectStore.openTimelineFile(path);
  await timelineStore.loadTimeline();
  void timelineStore.loadTimelineMetadata();
}

const metadataYaml = computed(() => {
  if (!fileInfo.value?.metadata) return null;
  try {
    return yaml.dump(fileInfo.value.metadata, { indent: 2 });
  } catch {
    return String(fileInfo.value.metadata);
  }
});

const mediaMeta = computed(() => fileInfo.value?.metadata as any);

const isFolderWithVideo = computed(() => {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory') return false;
  const children = Array.isArray(entry.children) ? entry.children : [];
  return children.some((c: any) => {
    if (c?.kind !== 'file') return false;
    const name = typeof c?.name === 'string' ? c.name : '';
    const e = name.split('.').pop()?.toLowerCase() ?? '';
    return VIDEO_EXTENSIONS.includes(e);
  });
});

const isGeneratingProxyForFolder = computed(() => {
  const entry = props.selectedFsEntry;
  const path = typeof entry?.path === 'string' ? entry.path : '';
  if (!path) return false;
  for (const p of proxyStore.generatingProxies) {
    if (typeof p === 'string' && (p === path || p.startsWith(`${path}/`))) return true;
  }
  return false;
});

async function generateProxiesForSelectedFolder() {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory' || !entry.path) return;
  await proxyStore.generateProxiesForFolder({
    dirHandle: entry.handle as FileSystemDirectoryHandle,
    dirPath: entry.path,
  });
}

async function stopProxyGenerationForSelectedFolder() {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory' || !entry.path) return;

  for (const p of proxyStore.generatingProxies) {
    if (typeof p !== 'string') continue;
    if (p === entry.path || p.startsWith(`${entry.path}/`)) {
      await proxyStore.cancelProxyGeneration(p);
    }
  }
}

// computeDirectorySize is now imported from ~/utils/fs

async function loadPreviewMedia() {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
    currentUrl.value = null;
  }

  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'file') return;

  try {
    let fileToPlay: File;

    if (props.previewMode === 'proxy' && props.hasProxy && entry.path) {
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

watch(
  () => props.previewMode,
  () => {
    void loadPreviewMedia();
  },
);

watch(
  () => props.selectedFsEntry,
  async (entry) => {
    // Revoke old URL
    if (currentUrl.value) {
      URL.revokeObjectURL(currentUrl.value);
      currentUrl.value = null;
    }
    mediaType.value = null;
    textContent.value = '';
    fileInfo.value = null;
    isMetaExpanded.value = false;
    timelineDocSummary.value = null;
    emit('update:previewMode', 'original');

    if (!entry) return;

    if (entry.kind === 'directory') {
      fileInfo.value = {
        name: entry.name,
        kind: 'directory',
        path: entry.path,
        size: await computeDirectorySize(entry.handle as FileSystemDirectoryHandle),
      };
      return;
    }

    try {
      const file = await (entry.handle as FileSystemFileHandle).getFile();

      const ext = entry.name.split('.').pop()?.toLowerCase() || '';
      const textExtensions = TEXT_EXTENSIONS;

      if (ext === 'otio') {
        mediaType.value = 'text';
        try {
          const text = await file.text();
          const parsedDoc = parseTimelineFromOtio(text, {
            id: entry.path ?? 'unknown',
            name: entry.name,
            fps: 25,
          });
          timelineDocSummary.value = computeTimelineSummary(parsedDoc);
        } catch {
          timelineDocSummary.value = null;
        }
      } else

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

      fileInfo.value = {
        name: file.name,
        kind: 'file',
        path: entry.path,
        size: file.size,
        lastModified: file.lastModified,
        mimeType: typeof file.type === 'string' ? file.type : undefined,
        ext,
        metadata:
          entry.path && (mediaType.value === 'video' || mediaType.value === 'audio')
            ? await mediaStore.getOrFetchMetadata(
                entry.handle as FileSystemFileHandle,
                entry.path,
                {
                  forceRefresh: true,
                },
              )
            : undefined,
      };

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
  { immediate: true },
);

onUnmounted(() => {
  if (currentUrl.value) {
    URL.revokeObjectURL(currentUrl.value);
  }
});
</script>

<template>
  <div class="w-full flex flex-col gap-4">
    <input
      ref="uploadInputRef"
      type="file"
      multiple
      class="hidden"
      @change="onDirectoryFileSelect"
    />

    <!-- Preview Box (only for files) -->
    <div
      v-if="selectedFsEntry?.kind === 'file'"
      class="w-full bg-ui-bg rounded border border-ui-border flex flex-col items-center justify-center min-h-50 overflow-hidden shrink-0"
    >
      <div
        v-if="isUnknown && !isOtio"
        class="flex flex-col items-center gap-3 text-ui-text-muted p-8 w-full h-full justify-center"
      >
        <UIcon name="i-heroicons-document" class="w-16 h-16" />
        <p class="text-sm text-center">
          {{
            t('granVideoEditor.preview.unsupported', 'Unsupported file format for visual preview')
          }}
        </p>
      </div>

      <div v-else-if="currentUrl" class="w-full h-full flex flex-col">
        <img
          v-if="mediaType === 'image'"
          :src="currentUrl"
          class="max-w-full max-h-64 object-contain mx-auto my-auto"
        />
        <MediaPlayer
          v-else-if="mediaType === 'video' || mediaType === 'audio'"
          :src="currentUrl"
          :type="mediaType"
          class="w-full h-64"
        />
      </div>

      <pre
        v-else-if="mediaType === 'text'"
        class="w-full max-h-64 overflow-auto p-4 text-xs font-mono text-ui-text whitespace-pre-wrap"
        >{{ textContent }}</pre
      >
    </div>

    <PropertySection
      v-if="fileInfo?.kind === 'directory' && (isFolderWithVideo || isGeneratingProxyForFolder)"
      :title="t('videoEditor.fileManager.proxy.title', 'Proxy')"
    >
      <div class="flex gap-2">
        <UButton
          v-if="!isGeneratingProxyForFolder"
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-heroicons-bolt"
          class="flex-1"
          @click="generateProxiesForSelectedFolder"
        >
          {{ t('videoEditor.fileManager.proxy.generate', 'Generate proxies') }}
        </UButton>
        <UButton
          v-else
          size="xs"
          color="red"
          variant="soft"
          icon="i-heroicons-stop"
          class="flex-1"
          @click="stopProxyGenerationForSelectedFolder"
        >
          {{ t('videoEditor.fileManager.proxy.stop', 'Stop proxy generation') }}
        </UButton>
      </div>
    </PropertySection>

    <PropertySection
      v-if="fileInfo?.kind === 'directory'"
      :title="t('videoEditor.fileManager.actions.title', 'Actions')"
    >
      <div class="flex">
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-heroicons-arrow-up-tray"
          class="w-full"
          @click="triggerDirectoryUpload"
        >
          {{ t('videoEditor.fileManager.actions.uploadFiles', 'Upload files') }}
        </UButton>
      </div>
    </PropertySection>

    <PropertySection
      v-if="fileInfo?.kind === 'file' && mediaType === 'image'"
      :title="t('videoEditor.fileManager.image.title', 'Image')"
    >
      <PropertyRow :label="t('common.extension', 'Extension')" value="нет" />
    </PropertySection>

    <PropertySection
      v-if="fileInfo?.kind === 'file' && mediaType === 'video'"
      :title="t('videoEditor.fileManager.video.title', 'Video')"
    >
      <PropertyRow
        :label="t('common.duration', 'Duration')"
        :value="formatDurationSeconds(mediaMeta?.duration)"
      />
      <PropertyRow
        :label="t('videoEditor.fileManager.video.resolution', 'Resolution')"
        :value="
          mediaMeta?.video?.displayWidth && mediaMeta?.video?.displayHeight
            ? `${mediaMeta.video.displayWidth}x${mediaMeta.video.displayHeight}`
            : '-'
        "
      />
      <PropertyRow :label="t('videoEditor.fileManager.video.fps', 'FPS')" :value="mediaMeta?.video?.fps ?? '-'" />
      <PropertyRow :label="t('videoEditor.fileManager.video.container', 'Container')" :value="mediaMeta?.container ?? '-'" />
      <PropertyRow
        :label="t('videoEditor.fileManager.video.videoCodec', 'Video codec')"
      >
        {{ mediaMeta?.video?.parsedCodec ?? mediaMeta?.video?.codec ?? '-' }}
        <span v-if="mediaMeta?.video?.bitrate">, {{ formatBitrate(mediaMeta.video.bitrate) }}</span>
      </PropertyRow>
      <PropertyRow
        :label="t('videoEditor.fileManager.video.audioCodec', 'Audio codec')"
      >
        {{ mediaMeta?.audio?.parsedCodec ?? mediaMeta?.audio?.codec ?? '-' }}
        <span v-if="mediaMeta?.audio?.bitrate">, {{ formatBitrate(mediaMeta.audio.bitrate) }}</span>
      </PropertyRow>
      <PropertyRow :label="t('videoEditor.fileManager.audio.channels', 'Channels')">
        {{ formatAudioChannels(mediaMeta?.audio?.channels) }},
        {{ mediaMeta?.audio?.sampleRate ? `${mediaMeta.audio.sampleRate} Hz` : '-' }}
      </PropertyRow>
    </PropertySection>

    <PropertySection
      v-if="fileInfo?.kind === 'file' && mediaType === 'audio'"
      :title="t('videoEditor.fileManager.audio.title', 'Audio')"
    >
      <PropertyRow
        :label="t('common.duration', 'Duration')"
        :value="formatDurationSeconds(mediaMeta?.duration)"
      />
      <PropertyRow :label="t('videoEditor.fileManager.audio.format', 'Format')" :value="mediaMeta?.container ?? fileInfo?.mimeType ?? '-'" />
      <PropertyRow
        :label="t('videoEditor.fileManager.audio.codec', 'Audio codec')"
      >
        {{ mediaMeta?.audio?.parsedCodec ?? mediaMeta?.audio?.codec ?? '-' }}
        <span v-if="mediaMeta?.audio?.bitrate">, {{ formatBitrate(mediaMeta.audio.bitrate) }}</span>
      </PropertyRow>
      <PropertyRow :label="t('videoEditor.fileManager.audio.channels', 'Channels')">
        {{ formatAudioChannels(mediaMeta?.audio?.channels) }},
        {{ mediaMeta?.audio?.sampleRate ? `${mediaMeta.audio.sampleRate} Hz` : '-' }}
      </PropertyRow>
    </PropertySection>

    <PropertySection
      v-if="fileInfo?.kind === 'file' && isOtio && timelineDocSummary"
      :title="t('videoEditor.fileManager.otio.title', 'OTIO')"
    >
      <PropertyRow
        :label="t('common.duration', 'Duration')"
        :value="formatDurationSeconds((timelineDocSummary.durationUs ?? 0) / 1_000_000)"
      />
      <PropertyRow
        :label="t('videoEditor.fileManager.otio.videoTracks', 'Video tracks')"
        :value="timelineDocSummary.videoTracks"
      />
      <PropertyRow
        :label="t('videoEditor.fileManager.otio.audioTracks', 'Audio tracks')"
        :value="timelineDocSummary.audioTracks"
      />
      <PropertyRow :label="t('videoEditor.fileManager.otio.clips', 'Clips')" :value="timelineDocSummary.clips" />
    </PropertySection>

    <PropertySection
      v-if="fileInfo?.kind === 'file' && (mediaType === 'video' || mediaType === 'audio') && metadataYaml"
      :title="t('common.meta', 'Meta')"
    >
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        :label="isMetaExpanded ? t('common.hide', 'Hide') : t('common.show', 'Show')"
        @click="isMetaExpanded = !isMetaExpanded"
      />
      <pre
        v-if="isMetaExpanded"
        class="w-full p-2 bg-ui-bg text-[10px] font-mono whitespace-pre overflow-x-auto border border-ui-border rounded"
        >{{ metadataYaml }}</pre
      >
    </PropertySection>

    <PropertySection v-if="fileInfo" :title="t('common.file', 'File')">
      <PropertyRow :label="t('common.path', 'Path')" :value="selectedPath ?? '-'" />
      <PropertyRow :label="t('common.size', 'Size')" :value="fileInfo.size !== undefined ? formatBytes(fileInfo.size) : '-'" />
      <PropertyRow
        :label="t('common.created', 'Created')"
        :value="fileInfo.lastModified ? new Date(fileInfo.lastModified).toLocaleString() : '-'"
      />
      <PropertyRow :label="t('common.hidden', 'Hidden')" :value="isHidden ? 'Yes' : 'No'" />
      <PropertyRow
        :label="t('common.type', 'Type')"
        :value="fileInfo.kind === 'directory' ? 'folder' : fileInfo.mimeType ?? '-'"
      />
    </PropertySection>

    <!-- Usage in timelines -->
    <div
      v-if="timelinesUsingSelectedFile.length > 0"
      class="space-y-2 bg-ui-bg-elevated p-2 rounded border border-ui-border"
    >
      <div
        class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest border-b border-ui-border pb-1"
      >
        {{ t('granVideoEditor.preview.usedInTimelines', 'Used in timelines') }}
      </div>
      <div class="flex flex-wrap gap-1 mt-1">
        <UButton
          v-for="usage in timelinesUsingSelectedFile"
          :key="usage.timelinePath"
          size="xs"
          variant="soft"
          color="neutral"
          icon="i-heroicons-clock"
          @click="openTimelineFromUsage(usage.timelinePath)"
        >
          {{ usage.timelineName.replace('.otio', '') }}
        </UButton>
      </div>
    </div>
  </div>
</template>
