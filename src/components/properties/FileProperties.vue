<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { formatBytes, formatBitrate, formatDurationSeconds } from '~/utils/format';
import { VIDEO_EXTENSIONS } from '~/utils/media-types';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import EntryPreviewBox from '~/components/properties/file/EntryPreviewBox.vue';
import { useEntryPreview } from '~/composables/fileManager/useEntryPreview';

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

const isMetaExpanded = ref(false);
const isExifExpanded = ref(false);

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

const selectedFsEntryRef = computed(() => props.selectedFsEntry);
const previewModeRef = computed(() => props.previewMode);
const hasProxyRef = computed(() => props.hasProxy);

const {
  currentUrl,
  mediaType,
  textContent,
  fileInfo,
  timelineDocSummary,
  exifData,
  exifYaml,
  imageDimensions,
  metadataYaml,
  isUnknown,
  isOtio,
} = useEntryPreview({
  selectedFsEntry: selectedFsEntryRef,
  previewMode: previewModeRef,
  hasProxy: hasProxyRef,
  mediaStore,
  proxyStore,
  onResetPreviewMode: (mode) => emit('update:previewMode', mode),
});

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

const imageResolution = computed(() => {
  if (mediaType.value !== 'image') return null;
  const exif = exifData.value as any;
  const width =
    exif?.ExifImageWidth ??
    exif?.ImageWidth ??
    exif?.PixelXDimension ??
    exif?.SourceImageWidth ??
    imageDimensions.value?.width ??
    null;
  const height =
    exif?.ExifImageHeight ??
    exif?.ImageHeight ??
    exif?.PixelYDimension ??
    exif?.SourceImageHeight ??
    imageDimensions.value?.height ??
    null;

  if (typeof width === 'number' && typeof height === 'number') return `${width}x${height}`;
  return null;
});

const imageCreateDate = computed(() => {
  if (mediaType.value !== 'image') return null;
  const exif = exifData.value as any;
  if (!exif) return null;

  const date: unknown = exif.CreateDate ?? exif.DateTimeOriginal ?? exif.ModifyDate ?? null;
  if (!date) return null;
  if (date instanceof Date) return date.toLocaleString();
  if (typeof date === 'string') return date;
  return null;
});

const imageCameraMake = computed(() => {
  if (mediaType.value !== 'image') return null;
  const exif = exifData.value as any;
  if (!exif) return null;
  return typeof exif.Make === 'string' && exif.Make.trim().length > 0 ? exif.Make : null;
});

const imageLocationLink = computed(() => {
  if (mediaType.value !== 'image') return null;
  const exif = exifData.value as any;
  if (!exif) return null;

  const lat = exif.latitude ?? exif.Latitude ?? exif.GPSLatitude ?? null;
  const lng = exif.longitude ?? exif.Longitude ?? exif.GPSLongitude ?? null;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  return `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
});

const hasImageInfo = computed(() => {
  return Boolean(
    imageResolution.value || imageCreateDate.value || imageLocationLink.value || imageCameraMake.value,
  );
});

function formatAudioChannels(channels: number | undefined) {
  if (!channels || channels <= 0) return '-';
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  return `${channels} tracks`;
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

const generalInfoTitle = computed(() => {
  if (!fileInfo.value) return '';
  if (fileInfo.value.kind === 'directory') return 'Folder';
  if (isOtio.value) return 'OTIO';
  return fileInfo.value.mimeType ?? 'File';
});

const mediaMeta = computed(() => fileInfo.value?.metadata as any);

const isVideoOrAudio = computed(() => mediaType.value === 'video' || mediaType.value === 'audio');

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

    <EntryPreviewBox
      :selected-entry-kind="selectedFsEntry?.kind ?? null"
      :is-otio="isOtio"
      :is-unknown="isUnknown"
      :current-url="currentUrl"
      :media-type="mediaType"
      :text-content="textContent"
    />

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

    <div
      v-if="fileInfo?.kind === 'file' && mediaType === 'image' && hasImageInfo"
      class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full"
    >
      <div class="flex flex-col">
        <PropertyRow
          v-if="imageResolution"
          :label="t('videoEditor.fileManager.image.resolution', 'Resolution')"
          :value="imageResolution"
        />
        <PropertyRow
          v-if="imageCreateDate"
          label="CreateDate"
          :value="imageCreateDate"
        />
        <PropertyRow
          v-if="imageLocationLink"
          :label="t('videoEditor.fileManager.image.location', 'Location')"
        >
          <a
            class="text-primary-500 hover:underline break-all"
            :href="imageLocationLink"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Maps
          </a>
        </PropertyRow>
        <PropertyRow
          v-if="imageCameraMake"
          :label="t('videoEditor.fileManager.image.camera', 'Camera')"
          :value="imageCameraMake"
        />
      </div>
    </div>

    <div
      v-if="fileInfo?.kind === 'file' && mediaType === 'video'"
      class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full"
    >
      <div class="flex flex-col">
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
      </div>
    </div>

    <div
      v-if="fileInfo?.kind === 'file' && mediaType === 'audio'"
      class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full"
    >
      <div class="flex flex-col">
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
      </div>
    </div>

    <div
      v-if="fileInfo?.kind === 'file' && isOtio && timelineDocSummary"
      class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full"
    >
      <div class="flex flex-col">
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
      </div>
    </div>

    <PropertySection v-if="fileInfo" :title="generalInfoTitle">
      <PropertyRow :label="t('common.path', 'Path')" :value="selectedPath ?? '-'" />
      <PropertyRow :label="t('common.size', 'Size')" :value="fileInfo.size !== undefined ? formatBytes(fileInfo.size) : '-'" />
      <PropertyRow
        :label="t('common.created', 'Created')"
        :value="(fileInfo.createdAt ?? fileInfo.lastModified) ? new Date(fileInfo.createdAt ?? fileInfo.lastModified!).toLocaleString() : '-'"
      />
      <PropertyRow
        :label="t('common.updated', 'Updated')"
        :value="fileInfo.lastModified ? new Date(fileInfo.lastModified).toLocaleString() : '-'"
      />
      <PropertyRow :label="t('common.hidden', 'Hidden')" :value="isHidden ? 'Yes' : 'No'" />
    </PropertySection>

    <!-- Usage in timelines -->
    <div
      v-if="timelinesUsingSelectedFile.length > 0"
      class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border"
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

    <PropertySection
      v-if="fileInfo?.kind === 'file' && isVideoOrAudio && metadataYaml"
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
        >{{ metadataYaml }}</pre>
    </PropertySection>

    <PropertySection
      v-if="fileInfo?.kind === 'file' && mediaType === 'image' && exifYaml"
      title="EXIF"
    >
      <UButton
        size="xs"
        variant="ghost"
        color="neutral"
        :label="isExifExpanded ? t('common.hide', 'Hide') : t('common.show', 'Show')"
        @click="isExifExpanded = !isExifExpanded"
      />
      <pre
        v-if="isExifExpanded"
        class="w-full p-2 bg-ui-bg text-[10px] font-mono whitespace-pre overflow-x-auto border border-ui-border rounded"
        >{{ exifYaml }}</pre>
    </PropertySection>
  </div>
</template>
