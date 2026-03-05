<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { formatBytes, formatBitrate, formatDurationSeconds } from '~/utils/format';
import { VIDEO_EXTENSIONS, getMediaTypeFromFilename } from '~/utils/media-types';
import { formatAudioChannels } from '~/utils/audio';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import EntryPreviewBox from '~/components/properties/file/EntryPreviewBox.vue';
import { useEntryPreview } from '~/composables/fileManager/useEntryPreview';
import { useImageExifInfo } from '~/composables/properties/useImageExifInfo';
import { useFileTimelineUsage } from '~/composables/properties/useFileTimelineUsage';
import { useFileProxyFolder } from '~/composables/properties/useFileProxyFolder';
import { useFilePropertiesBasics } from '~/composables/properties/useFilePropertiesBasics';
import { useFileStorageInfo } from '~/composables/properties/useFileStorageInfo';
import EntryActions from '~/components/properties/file/EntryActions.vue';
import { useProjectTabs } from '~/composables/project/useProjectTabs';
import { useFileManager } from '~/composables/fileManager/useFileManager';

const props = defineProps<{
  selectedFsEntry: any;
  previewMode: 'original' | 'proxy';
  hasProxy: boolean;
  isFilesPage?: boolean;
}>();

const emit = defineEmits<{
  'update:previewMode': [val: 'original' | 'proxy'];
  convert: [entry: any];
}>();

const { t } = useI18n();
const mediaStore = useMediaStore();
const proxyStore = useProxyStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const { addFileTab, setActiveTab } = useProjectTabs();
const fileManager = useFileManager();

const isMetaExpanded = ref(false);
const isExifExpanded = ref(false);

const uploadInputRef = ref<HTMLInputElement | null>(null);

const selectedFsEntryRef = computed(() => props.selectedFsEntry);
const previewModeRef = computed(() => props.previewMode);
const hasProxyRef = computed(() => props.hasProxy);

const { isProjectRootDir, storageFreeBytes } = useFileStorageInfo({
  selectedFsEntry: selectedFsEntryRef,
  currentProjectName: computed(() => projectStore.currentProjectName),
});

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

  if (isProjectRootDir.value) {
    await fileManager.handleFiles(files);
  } else {
    await fileManager.handleFiles(files, entry.handle as FileSystemDirectoryHandle, entry.path);
  }
  await fileManager.loadProjectDirectory();
  uiStore.notifyFileManagerUpdate();
}

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

const { ext, generalInfoTitle, isHidden, mediaMeta, selectedPath } = useFilePropertiesBasics({
  selectedFsEntry: selectedFsEntryRef,
  fileInfo,
  isOtio,
  mediaType,
});

const { hasImageInfo, imageCameraMake, imageCreateDate, imageLocationLink, imageResolution } =
  useImageExifInfo({
    mediaType,
    exifData,
    imageDimensions,
  });

const { timelinesUsingSelectedFile, openTimelineFromUsage } = useFileTimelineUsage({
  selectedFsEntry: selectedFsEntryRef,
  timelineMediaUsageStore,
  projectStore,
  timelineStore,
});

const {
  generateProxiesForSelectedFolder,
  isFolderWithVideo,
  isGeneratingProxyForFolder,
  stopProxyGenerationForSelectedFolder,
} = useFileProxyFolder({
  selectedFsEntry: selectedFsEntryRef,
  proxyStore,
  videoExtensions: VIDEO_EXTENSIONS,
});

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    useToast().add({ title: 'Copied to clipboard' });
  } catch (e) {
    console.error('Failed to copy to clipboard', e);
  }
}

function openAsProjectTab() {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'file' || !entry.path) return;
  const type = getMediaTypeFromFilename(entry.name);
  if (type !== 'video' && type !== 'audio' && type !== 'image' && type !== 'text') return;
  const tabId = addFileTab({ filePath: entry.path, fileName: entry.name });
  setActiveTab(tabId);
}

function createSubfolder() {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory') return;
  uiStore.pendingFsEntryCreateFolder = entry;
}

function createTimelineInFolder() {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory') return;
  uiStore.pendingFsEntryCreateTimeline = entry;
}

function createMarkdownInFolder() {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory') return;
  uiStore.pendingFsEntryCreateMarkdown = entry;
}

const canOpenAsPanel = computed(() => {
  return (
    mediaType.value === 'text' ||
    mediaType.value === 'video' ||
    mediaType.value === 'audio' ||
    mediaType.value === 'image'
  );
});

const canOpenAsProjectTab = computed(() => {
  return canOpenAsPanel.value;
});

const isVideoFile = computed(() => mediaType.value === 'video');

const showVideoProxyActions = computed(() => {
  if (isProjectRootDir.value) return false;
  if (!isVideoFile.value) return false;
  if (!selectedPath.value) return false;
  return true;
});

const isGeneratingProxyForFile = computed(() => {
  if (!showVideoProxyActions.value) return false;
  return proxyStore.generatingProxies.has(selectedPath.value!);
});

const hasExistingProxyForFile = computed(() => {
  if (!showVideoProxyActions.value) return false;
  return proxyStore.existingProxies.has(selectedPath.value!);
});

function onRename() {
  const entry = props.selectedFsEntry;
  if (!entry) return;
  uiStore.pendingFsEntryRename = entry;
}

function onDelete() {
  const entry = props.selectedFsEntry;
  if (!entry) return;
  uiStore.pendingFsEntryDelete = entry;
}

function openAsTextPanel() {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'file') return;

  projectStore.goToCut();

  if (mediaType.value === 'text') {
    projectStore.addTextPanel(entry.path ?? entry.name, textContent.value, entry.name);
  } else if (
    mediaType.value === 'video' ||
    mediaType.value === 'audio' ||
    mediaType.value === 'image'
  ) {
    projectStore.addMediaPanel(entry, mediaType.value, entry.name);
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
      :file-path="selectedFsEntry?.path"
      :file-name="selectedFsEntry?.name"
    />

    <PropertySection
      v-if="fileInfo?.kind === 'directory' && isProjectRootDir"
      :title="t('videoEditor.fileManager.projectRoot.title', 'Project root')"
    >
      <PropertyRow
        :label="t('videoEditor.fileManager.projectRoot.project', 'Project')"
        :value="projectStore.currentProjectName ?? '-'"
      />
      <PropertyRow
        v-if="storageFreeBytes !== null"
        :label="t('videoEditor.fileManager.projectRoot.freeSpace', 'Free space')"
        :value="formatBytes(storageFreeBytes)"
      />
    </PropertySection>

    <PropertySection
      v-if="fileInfo?.kind === 'directory'"
      :title="t('videoEditor.fileManager.actions.title', 'Actions')"
    >
      <EntryActions
        :primary-actions="[
          {
            id: 'rename',
            title: t('common.rename', 'Rename'),
            icon: 'i-heroicons-pencil',
            hidden: isProjectRootDir,
            onClick: onRename,
          },
          {
            id: 'delete',
            title: t('common.delete', 'Delete'),
            icon: 'i-heroicons-trash',
            hidden: isProjectRootDir,
            onClick: onDelete,
          },
          {
            id: 'upload',
            title: t('videoEditor.fileManager.actions.uploadFiles', 'Upload files'),
            icon: 'i-heroicons-arrow-up-tray',
            onClick: triggerDirectoryUpload,
          },
        ]"
        :secondary-actions="[
          {
            id: 'createSubfolder',
            label: t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
            icon: 'i-heroicons-folder-plus',
            onClick: createSubfolder,
          },
          {
            id: 'createTimeline',
            label: t('videoEditor.fileManager.actions.createTimeline', 'Create Timeline'),
            icon: 'i-heroicons-document-plus',
            onClick: createTimelineInFolder,
          },
          {
            id: 'createMarkdown',
            label: t('videoEditor.fileManager.actions.createMarkdown', 'Create Markdown document'),
            icon: 'i-heroicons-document-text',
            onClick: createMarkdownInFolder,
          },
          {
            id: 'createProxyForAll',
            label: t(
              'videoEditor.fileManager.actions.createProxyForAll',
              'Create proxy for all videos',
            ),
            icon: 'i-heroicons-film',
            hidden: !isFolderWithVideo || isGeneratingProxyForFolder,
            onClick: () => generateProxiesForSelectedFolder(),
          },
          {
            id: 'cancelProxyForAll',
            label: t(
              'videoEditor.fileManager.actions.cancelProxyGeneration',
              'Cancel proxy generation',
            ),
            icon: 'i-heroicons-x-circle',
            color: 'error',
            hidden: !isFolderWithVideo || !isGeneratingProxyForFolder,
            onClick: () => stopProxyGenerationForSelectedFolder(),
          },
        ]"
      />
    </PropertySection>

    <PropertySection
      v-else-if="fileInfo?.kind === 'file'"
      :title="t('videoEditor.fileManager.actions.title', 'Actions')"
    >
      <EntryActions
        :primary-actions="[
          {
            id: 'rename',
            title: t('common.rename', 'Rename'),
            icon: 'i-heroicons-pencil',
            onClick: onRename,
          },
          {
            id: 'delete',
            title: t('common.delete', 'Delete'),
            icon: 'i-heroicons-trash',
            onClick: onDelete,
          },
          {
            id: 'openAsPanel',
            title: t('videoEditor.fileManager.actions.openAsPanel', 'Open as panel'),
            icon: 'i-heroicons-window',
            hidden: !canOpenAsPanel || props.isFilesPage,
            onClick: openAsTextPanel,
          },
          {
            id: 'openAsProjectTab',
            title: t('videoEditor.fileManager.actions.openAsProjectTab', 'Open as project tab'),
            icon: 'i-heroicons-squares-plus',
            hidden: !canOpenAsProjectTab || props.isFilesPage,
            onClick: openAsProjectTab,
          },
        ]"
        :secondary-actions="[
          {
            id: 'convertFile',
            label: t('videoEditor.fileManager.actions.convertFile', 'Convert File'),
            icon: 'i-heroicons-arrow-path',
            hidden: !canOpenAsPanel,
            onClick: () => emit('convert', props.selectedFsEntry),
          },
          {
            id: 'createProxy',
            label: hasExistingProxyForFile
              ? t('videoEditor.fileManager.proxy.regenerate', 'Regenerate proxy')
              : t('videoEditor.fileManager.proxy.create', 'Create proxy'),
            icon: hasExistingProxyForFile ? 'i-heroicons-arrow-path' : 'i-heroicons-film',
            hidden: !showVideoProxyActions || isGeneratingProxyForFile,
            onClick: () =>
              proxyStore.generateProxy(
                props.selectedFsEntry.handle as FileSystemFileHandle,
                selectedPath!,
              ),
          },
          {
            id: 'cancelProxy',
            label: t(
              'videoEditor.fileManager.actions.cancelProxyGeneration',
              'Cancel proxy generation',
            ),
            icon: 'i-heroicons-x-circle',
            color: 'error',
            hidden: !showVideoProxyActions || !isGeneratingProxyForFile,
            onClick: () => proxyStore.cancelProxyGeneration(selectedPath!),
          },
          {
            id: 'deleteProxy',
            label: t('videoEditor.fileManager.proxy.delete', 'Delete proxy'),
            icon: 'i-heroicons-trash',
            color: 'error',
            hidden: !showVideoProxyActions || !hasExistingProxyForFile,
            onClick: () => proxyStore.deleteProxy(selectedPath!),
          },
          {
            id: 'createOtioVersion',
            label: t('granVideoEditor.timeline.createVersion', 'Create version'),
            icon: 'i-heroicons-document-duplicate',
            hidden: !isOtio,
            onClick: () => (uiStore.pendingOtioCreateVersion = props.selectedFsEntry),
          },
        ]"
      />
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
        <PropertyRow v-if="imageCreateDate" label="CreateDate" :value="imageCreateDate" />
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
        <PropertyRow
          :label="t('videoEditor.fileManager.video.fps', 'FPS')"
          :value="mediaMeta?.video?.fps ?? '-'"
        />
        <PropertyRow
          :label="t('videoEditor.fileManager.video.container', 'Container')"
          :value="mediaMeta?.container ?? '-'"
        />
        <PropertyRow :label="t('videoEditor.fileManager.video.videoCodec', 'Video codec')">
          {{ mediaMeta?.video?.parsedCodec ?? mediaMeta?.video?.codec ?? '-' }}
          <span v-if="mediaMeta?.video?.bitrate"
            >, {{ formatBitrate(mediaMeta.video.bitrate) }}</span
          >
        </PropertyRow>
        <PropertyRow :label="t('videoEditor.fileManager.video.audioCodec', 'Audio codec')">
          {{ mediaMeta?.audio?.parsedCodec ?? mediaMeta?.audio?.codec ?? '-' }}
          <span v-if="mediaMeta?.audio?.bitrate"
            >, {{ formatBitrate(mediaMeta.audio.bitrate) }}</span
          >
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
        <PropertyRow
          :label="t('videoEditor.fileManager.audio.format', 'Format')"
          :value="mediaMeta?.container ?? fileInfo?.mimeType ?? '-'"
        />
        <PropertyRow :label="t('videoEditor.fileManager.audio.codec', 'Audio codec')">
          {{ mediaMeta?.audio?.parsedCodec ?? mediaMeta?.audio?.codec ?? '-' }}
          <span v-if="mediaMeta?.audio?.bitrate"
            >, {{ formatBitrate(mediaMeta.audio.bitrate) }}</span
          >
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
          :label="t('granVideoEditor.timeline.version', 'Version')"
          :value="timelineDocSummary.version ?? '-'"
        />
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
        <PropertyRow
          :label="t('videoEditor.fileManager.otio.clips', 'Clips')"
          :value="timelineDocSummary.clips"
        />
      </div>
    </div>

    <PropertySection v-if="fileInfo" :title="generalInfoTitle">
      <PropertyRow
        v-if="selectedPath !== undefined && selectedPath !== null"
        :label="t('common.path', 'Path')"
        :value="selectedPath === '' ? '/' : selectedPath"
      />
      <PropertyRow
        v-if="fileInfo.size !== undefined"
        :label="t('common.size', 'Size')"
        :value="formatBytes(fileInfo.size)"
      />
      <PropertyRow
        v-if="fileInfo.createdAt || fileInfo.lastModified"
        :label="t('common.created', 'Created')"
        :value="new Date(fileInfo.createdAt ?? fileInfo.lastModified!).toLocaleString()"
      />
      <PropertyRow
        v-if="fileInfo.lastModified"
        :label="t('common.updated', 'Updated')"
        :value="new Date(fileInfo.lastModified).toLocaleString()"
      />
      <PropertyRow v-if="isHidden" :label="t('common.hidden', 'Hidden')" value="Yes" />
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
      v-if="fileInfo?.kind === 'file' && isVideoFile && metadataYaml"
      :title="t('common.meta', 'Meta')"
    >
      <div class="flex gap-2">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          :label="isMetaExpanded ? t('common.hide', 'Hide') : t('common.show', 'Show')"
          @click="isMetaExpanded = !isMetaExpanded"
        />
        <UButton
          v-if="isMetaExpanded"
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-clipboard-document"
          :title="t('common.copy', 'Copy')"
          @click="() => copyToClipboard(metadataYaml!)"
        />
      </div>
      <pre
        v-if="isMetaExpanded"
        class="w-full p-2 bg-ui-bg text-[10px] font-mono whitespace-pre overflow-x-auto border border-ui-border rounded"
        >{{ metadataYaml }}</pre
      >
    </PropertySection>

    <PropertySection
      v-if="fileInfo?.kind === 'file' && mediaType === 'image' && exifYaml"
      title="EXIF"
    >
      <div class="flex gap-2">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          :label="isExifExpanded ? t('common.hide', 'Hide') : t('common.show', 'Show')"
          @click="isExifExpanded = !isExifExpanded"
        />
        <UButton
          v-if="isExifExpanded"
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-clipboard-document"
          :title="t('common.copy', 'Copy')"
          @click="() => copyToClipboard(exifYaml!)"
        />
      </div>
      <pre
        v-if="isExifExpanded"
        class="w-full p-2 bg-ui-bg text-[10px] font-mono whitespace-pre overflow-x-auto border border-ui-border rounded"
        >{{ exifYaml }}</pre
      >
    </PropertySection>
  </div>
</template>
