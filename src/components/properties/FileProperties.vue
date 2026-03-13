<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { formatBytes, formatBitrate, formatDurationSeconds } from '~/utils/format';
import {
  VIDEO_EXTENSIONS,
  getMediaTypeFromFilename,
  isOpenableProjectFileName,
} from '~/utils/media-types';
import { formatAudioChannels } from '~/utils/audio';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
import EntryPreviewBox from '~/components/properties/file/EntryPreviewBox.vue';
import { useEntryPreview } from '~/composables/fileManager/useEntryPreview';
import { useImageExifInfo } from '~/composables/properties/useImageExifInfo';
import { useFileTimelineUsage } from '~/composables/properties/useFileTimelineUsage';
import { useFileProxyFolder } from '~/composables/properties/useFileProxyFolder';
import { useFilePropertiesBasics } from '~/composables/properties/useFilePropertiesBasics';
import { useFilePropertiesActions } from '~/composables/properties/useFilePropertiesActions';
import { useFilePropertiesTranscription } from '~/composables/properties/useFilePropertiesTranscription';
import { useFileStorageInfo } from '~/composables/properties/useFileStorageInfo';
import EntryActions from '~/components/properties/file/EntryActions.vue';
import { useAudioExtraction } from '~/composables/fileManager/useAudioExtraction';
import { useProjectTabs } from '~/composables/project/useProjectTabs';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import AppModal from '~/components/ui/AppModal.vue';
import type { FsEntry } from '~/types/fs';

const props = defineProps<{
  selectedFsEntry: FsEntry;
  previewMode: 'original' | 'proxy';
  hasProxy: boolean;
  isFilesPage?: boolean;
}>();

const emit = defineEmits<{
  'update:previewMode': [val: 'original' | 'proxy'];
  convert: [entry: FsEntry];
}>();

const { t } = useI18n();
const mediaStore = useMediaStore();
const proxyStore = useProxyStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();
const workspaceStore = useWorkspaceStore();
const toast = useToast();
const { extractAudio } = useAudioExtraction();
const { addFileTab, setActiveTab } = useProjectTabs();
const fileManager = useFileManager();
const runtimeConfig = useRuntimeConfig();

const isMetaExpanded = ref(false);
const isExifExpanded = ref(false);

const remoteFilesConfig = computed(() =>
  resolveExternalServiceConfig({
    service: 'files',
    integrations: workspaceStore.userSettings.integrations,
    fastcatPublicadorBaseUrl:
      typeof runtimeConfig.public.fastcatPublicadorBaseUrl === 'string'
        ? runtimeConfig.public.fastcatPublicadorBaseUrl
        : '',
  }),
);

const canUploadToRemote = computed(() => {
  const entry = props.selectedFsEntry;
  return entry?.kind === 'file' && entry?.source !== 'remote' && Boolean(remoteFilesConfig.value);
});

const sttConfig = computed(() =>
  resolveExternalServiceConfig({
    service: 'stt',
    integrations: workspaceStore.userSettings.integrations,
    fastcatPublicadorBaseUrl:
      typeof runtimeConfig.public.fastcatPublicadorBaseUrl === 'string'
        ? runtimeConfig.public.fastcatPublicadorBaseUrl
        : '',
  }),
);

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
    await fileManager.handleFiles(files, entry.path);
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
  getFileByPath: (path) => fileManager.vfs.getFile(path),
  onResetPreviewMode: (mode) => emit('update:previewMode', mode),
});

const { generalInfoTitle, isHidden, mediaMeta, selectedPath } = useFilePropertiesBasics({
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
  resolveDirectoryHandle: (path) => projectStore.getDirectoryHandleByPath(path),
});

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.add({ title: 'Copied to clipboard' });
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
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'file') return false;
  return isOpenableProjectFileName(entry.name);
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

const isAudioFile = computed(() => mediaType.value === 'audio');

const hasExistingProxyForFile = computed(() => {
  if (!showVideoProxyActions.value) return false;
  return proxyStore.existingProxies.has(selectedPath.value!);
});

const canConvertFile = computed(() => {
  return mediaType.value === 'video' || mediaType.value === 'audio' || mediaType.value === 'image';
});

function onRename() {
  const entry = props.selectedFsEntry;
  if (!entry) return;
  uiStore.pendingFsEntryRename = entry;
}

function onDelete() {
  const entry = props.selectedFsEntry;
  if (!entry) return;
  uiStore.pendingFsEntryDelete = [entry];
}

function openAsTextPanel(view: 'cut' | 'sound' = 'cut') {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'file') return;

  if (view === 'cut') {
    projectStore.goToCut();
  } else {
    projectStore.goToSound();
  }

  if (mediaType.value === 'text') {
    projectStore.addTextPanel(
      entry.path ?? entry.name,
      textContent.value,
      entry.name,
      undefined,
      undefined,
      view,
    );
  } else if (
    mediaType.value === 'video' ||
    mediaType.value === 'audio' ||
    mediaType.value === 'image'
  ) {
    projectStore.addMediaPanel(entry, mediaType.value, entry.name, undefined, undefined, view);
  }
}

function openRemoteUploadPicker() {
  if (!canUploadToRemote.value) return;
  const selectedEntry = props.selectedFsEntry;
  if (!selectedEntry || selectedEntry.kind !== 'file') return;
  uiStore.remoteExchangeLocalEntry = selectedEntry;
  uiStore.remoteExchangeModalOpen = true;
}

const {
  canTranscribeMedia,
  isTranscriptionModalOpen,
  transcriptionLanguage,
  isTranscribingAudio,
  transcriptionError,
  latestTranscriptionText,
  latestTranscriptionCacheKey,
  latestTranscriptionWasCached,
  openTranscriptionModal,
  submitAudioTranscription,
} = useFilePropertiesTranscription({
  selectedFsEntry: selectedFsEntryRef,
  isAudioFile,
  isVideoFile,
  sttConfig,
  workspaceHandle: computed(() => workspaceStore.workspaceHandle),
  currentProjectId: computed(() => projectStore.currentProjectId),
  resolvedStorageTopology: computed(() => workspaceStore.resolvedStorageTopology),
  userSettings: computed(() => workspaceStore.userSettings),
  fastcatPublicadorBaseUrl: computed(() =>
    typeof runtimeConfig.public.fastcatPublicadorBaseUrl === 'string'
      ? runtimeConfig.public.fastcatPublicadorBaseUrl
      : '',
  ),
  getFileByPath: (path) => projectStore.getFileByPath(path),
  toast,
});

const {
  directoryPrimaryActions,
  directorySecondaryActions,
  filePrimaryActions,
  fileSecondaryActions,
} = useFilePropertiesActions({
  t,
  isProjectRootDir,
  isFolderWithVideo,
  isGeneratingProxyForFolder,
  canConvertFile,
  canUploadToRemote,
  canTranscribeMedia,
  canOpenAsPanel,
  canOpenAsProjectTab,
  showVideoProxyActions,
  hasExistingProxyForFile,
  isGeneratingProxyForFile,
  isOtio,
  isVideoFile,
  triggerDirectoryUpload,
  createSubfolder,
  createTimelineInFolder,
  createMarkdownInFolder,
  generateProxiesForSelectedFolder,
  stopProxyGenerationForSelectedFolder,
  onRename,
  onDelete,
  onConvert: () => emit('convert', props.selectedFsEntry),
  openRemoteUploadPicker,
  openTranscriptionModal,
  openAsPanelCut: () => openAsTextPanel('cut'),
  openAsPanelSound: () => openAsTextPanel('sound'),
  openAsProjectTab,
  createProxy: async () => {
    const file = await projectStore.getFileByPath(selectedPath.value!);
    if (!file) return;
    await proxyStore.generateProxy(file, selectedPath.value!);
  },
  cancelProxy: () => proxyStore.cancelProxyGeneration(selectedPath.value!),
  deleteProxy: () => proxyStore.deleteProxy(selectedPath.value!),
  createOtioVersion: () => {
    uiStore.pendingOtioCreateVersion = props.selectedFsEntry;
  },
  extractAudio: () => extractAudio(props.selectedFsEntry),
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
        :primary-actions="directoryPrimaryActions"
        :secondary-actions="directorySecondaryActions"
      />
    </PropertySection>

    <PropertySection
      v-else-if="fileInfo?.kind === 'file'"
      :title="t('videoEditor.fileManager.actions.title', 'Actions')"
    >
      <EntryActions
        :primary-actions="filePrimaryActions"
        :secondary-actions="fileSecondaryActions"
      />
    </PropertySection>

    <!-- Usage in timelines -->
    <div
      v-if="timelinesUsingSelectedFile.length > 0"
      class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full"
    >
      <div
        class="text-[10px] font-bold text-ui-text-muted uppercase tracking-widest border-b border-ui-border pb-1"
      >
        {{ t('fastcat.preview.usedInTimelines', 'Used in timelines') }}
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
      v-if="fileInfo?.kind === 'file' && isVideoFile"
      class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full"
    >
      <div class="flex flex-col gap-2">
        <div class="flex flex-col">
          <PropertyRow
            :label="t('common.duration', 'Duration')"
            :value="formatDurationSeconds(mediaMeta?.duration)"
          />
        </div>
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

        <div class="flex flex-wrap gap-2 pt-1">
          <UButton
            size="xs"
            color="primary"
            variant="soft"
            icon="i-heroicons-microphone"
            :disabled="!canTranscribeMedia"
            @click="openTranscriptionModal"
          >
            {{ t('videoEditor.fileManager.actions.transcribe', 'Transcribe') }}
          </UButton>
          <span v-if="latestTranscriptionCacheKey" class="text-xs text-ui-text-muted self-center">
            {{
              latestTranscriptionWasCached
                ? t('videoEditor.fileManager.audio.transcriptionCached', 'Loaded from cache')
                : t('videoEditor.fileManager.audio.transcriptionSaved', 'Saved to cache')
            }}
          </span>
        </div>

        <UTextarea
          v-if="latestTranscriptionText"
          :model-value="latestTranscriptionText"
          :rows="8"
          readonly
        />
      </div>
    </div>

    <div
      v-if="fileInfo?.kind === 'file' && mediaType === 'audio'"
      class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full"
    >
      <div class="flex flex-col gap-2">
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

        <div class="flex flex-wrap gap-2 pt-1">
          <UButton
            size="xs"
            color="primary"
            variant="soft"
            icon="i-heroicons-microphone"
            :disabled="!canTranscribeMedia"
            @click="openTranscriptionModal"
          >
            {{ t('videoEditor.fileManager.actions.transcribe', 'Transcribe') }}
          </UButton>
          <span v-if="latestTranscriptionCacheKey" class="text-xs text-ui-text-muted self-center">
            {{
              latestTranscriptionWasCached
                ? t('videoEditor.fileManager.audio.transcriptionCached', 'Loaded from cache')
                : t('videoEditor.fileManager.audio.transcriptionSaved', 'Saved to cache')
            }}
          </span>
        </div>

        <UTextarea
          v-if="latestTranscriptionText"
          :model-value="latestTranscriptionText"
          :rows="8"
          readonly
        />
      </div>
    </div>

    <div
      v-if="fileInfo?.kind === 'file' && isOtio && timelineDocSummary"
      class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full"
    >
      <div class="flex flex-col">
        <PropertyRow
          :label="t('fastcat.timeline.version', 'Version')"
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

    <AppModal
      v-model:open="isTranscriptionModalOpen"
      :title="t('videoEditor.fileManager.actions.transcribe', 'Transcribe')"
      :close-button="!isTranscribingAudio"
      :prevent-close="isTranscribingAudio"
      :ui="{ content: 'sm:max-w-lg', body: 'overflow-y-auto' }"
    >
      <div class="flex flex-col gap-4">
        <div class="text-sm text-ui-text-muted">
          {{
            t(
              'videoEditor.fileManager.audio.transcriptionHint',
              'Send the current audio file to the configured STT service. Language is optional.',
            )
          }}
        </div>

        <UFormField :label="t('videoEditor.fileManager.audio.transcriptionLanguage', 'Language')">
          <UInput
            v-model="transcriptionLanguage"
            :disabled="isTranscribingAudio"
            placeholder="en"
          />
        </UFormField>

        <div v-if="transcriptionError" class="text-sm text-error-400">
          {{ transcriptionError }}
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="isTranscribingAudio"
            @click="isTranscriptionModalOpen = false"
          >
            {{ t('common.cancel', 'Cancel') }}
          </UButton>
          <UButton color="primary" :loading="isTranscribingAudio" @click="submitAudioTranscription">
            {{ t('videoEditor.fileManager.audio.transcriptionSubmit', 'Transcribe') }}
          </UButton>
        </div>
      </template>
    </AppModal>
  </div>
</template>
