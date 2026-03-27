<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { formatBytes, formatBitrate, formatDurationSeconds } from '~/utils/format';
import { VIDEO_EXTENSIONS } from '~/utils/media-types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import EntryPreviewBox from '~/components/properties/file/EntryPreviewBox.vue';
import MediaPropertiesSection from '~/components/properties/file/MediaPropertiesSection.vue';
import ExpandableYamlSection from '~/components/properties/file/ExpandableYamlSection.vue';
import FileGeneralInfoSection from '~/components/properties/file/FileGeneralInfoSection.vue';
import FileTimelineUsageSection from '~/components/properties/file/FileTimelineUsageSection.vue';
import ImageFilePropertiesSection from '~/components/properties/file/ImageFilePropertiesSection.vue';
import OtioPropertiesSection from '~/components/properties/file/OtioPropertiesSection.vue';
import FileProjectRootSection from '~/components/properties/file/FileProjectRootSection.vue';
import FileTranscriptionModal from '~/components/properties/file/FileTranscriptionModal.vue';
import EntryActions from '~/components/properties/file/EntryActions.vue';
import { useEntryPreview } from '~/composables/fileManager/useEntryPreview';
import { useImageExifInfo } from '~/composables/properties/useImageExifInfo';
import { useFileTimelineUsage } from '~/composables/properties/useFileTimelineUsage';
import { useFileProxyFolder } from '~/composables/properties/useFileProxyFolder';
import { useFilePropertiesBasics } from '~/composables/properties/useFilePropertiesBasics';
import { useFilePropertiesActions } from '~/composables/properties/useFilePropertiesActions';
import { useFilePropertiesTranscription } from '~/composables/properties/useFilePropertiesTranscription';
import { useFileStorageInfo } from '~/composables/properties/useFileStorageInfo';
import { useFilePropertiesHandlers } from '~/composables/properties/useFilePropertiesHandlers';
import { useAudioExtraction } from '~/composables/fileManager/useAudioExtraction';
import { useFileManager } from '~/composables/fileManager/useFileManager';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { isWorkspaceCommonPath, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
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
const fileManager = useFileManager();
const runtimeConfig = useRuntimeConfig();
const clipboardStore = useAppClipboard();

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

const { isProjectRootDir, storageFreeBytes, projectStats } = useFileStorageInfo({
  selectedFsEntry: selectedFsEntryRef,
  currentProjectName: computed(() => projectStore.currentProjectName),
  getDirectoryHandleByPath: (path) => projectStore.getDirectoryHandleByPath(path),
});

const isCommonRoot = computed(() => {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory') return false;
  return (
    entry.path === WORKSPACE_COMMON_PATH_PREFIX ||
    (entry.name.toLowerCase() === 'common' && (entry.path === 'common' || entry.path === ''))
  );
});

// isCommonPath matches all items within common, used for visual indicators but not for blocking actions anymore
const isCommonPath = computed(() => isWorkspaceCommonPath(props.selectedFsEntry?.path));

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
  exifData,
  exifYaml,
  imageDimensions,
  timelineDocSummary,
  lineCount,
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
  getDirectoryHandleByPath: (path) => projectStore.getDirectoryHandleByPath(path),
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
    toast.add({ title: t('common.copiedToClipboard', 'Copied to clipboard') });
  } catch (e) {
    console.error('Failed to copy to clipboard', e);
  }
}

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
  t,
});

const {
  canOpenAsPanel,
  canOpenAsProjectTab,
  openAsProjectTab,
  createSubfolder,
  createTimelineInFolder,
  createMarkdownInFolder,
  onRename,
  onDelete,
  openAsTextPanel,
  openRemoteUploadPicker,
} = useFilePropertiesHandlers({
  selectedFsEntry: selectedFsEntryRef,
  mediaType,
  textContent,
  canUploadToRemote,
});

const canCopyOrCut = computed(() => {
  return !isProjectRootDir.value && !isCommonRoot.value;
});

function onCopy() {
  const entry = props.selectedFsEntry;
  if (!entry || !entry.path) return;
  clipboardStore.setClipboardPayload({
    source: 'fileManager',
    operation: 'copy',
    items: [
      {
        path: entry.path,
        kind: entry.kind,
        name: entry.name,
      },
    ],
  });
}

function onCut() {
  const entry = props.selectedFsEntry;
  if (!entry || !entry.path) return;
  clipboardStore.setClipboardPayload({
    source: 'fileManager',
    operation: 'cut',
    items: [
      {
        path: entry.path,
        kind: entry.kind,
        name: entry.name,
      },
    ],
  });
}

function onPaste() {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory') return;
  const payload = clipboardStore.clipboardPayload;
  if (!payload || payload.source !== 'fileManager' || payload.items.length === 0) return;

  const targetDirPath = entry.path ?? '';
  for (const item of payload.items) {
    const source = fileManager.findEntryByPath(item.path);
    if (!source) continue;

    if (payload.operation === 'copy') {
      void fileManager.copyEntry({ source, targetDirPath });
    } else {
      void fileManager.moveEntry({ source, targetDirPath });
    }
  }

  if (payload.operation === 'cut') {
    clipboardStore.setClipboardPayload(null);
  }

  uiStore.notifyFileManagerUpdate();
}

const hasClipboardItems = computed(() => {
  return clipboardStore.hasFileManagerPayload;
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
  isAudioFile,
  canOpenAsPanel,
  canOpenAsProjectTab,
  showVideoProxyActions,
  hasExistingProxyForFile,
  isGeneratingProxyForFile,
  isOtio,
  isVideoFile,
  isCommonDir: isCommonRoot,
  isCommonPath,
  canCopyOrCut,
  hasClipboardItems,
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
  onCopy,
  onCut,
  onPaste,
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
      v-if="fileInfo?.kind !== 'directory'"
      :selected-entry-kind="selectedFsEntry?.kind ?? null"
      :is-unknown="isUnknown"
      :current-url="currentUrl"
      :media-type="mediaType"
      :text-content="textContent"
      :file-path="selectedFsEntry?.path"
      :file-name="selectedFsEntry?.name"
      :is-otio="isOtio"
    />

    <ImageFilePropertiesSection
      v-if="fileInfo?.kind === 'file' && mediaType === 'image' && hasImageInfo"
      :image-resolution="imageResolution"
      :image-create-date="imageCreateDate"
      :image-location-link="imageLocationLink"
      :image-camera-make="imageCameraMake"
    />

    <MediaPropertiesSection
      v-if="fileInfo?.kind === 'file' && (isVideoFile || mediaType === 'audio')"
      :media-meta="mediaMeta"
      :format-duration-seconds="formatDurationSeconds"
      :format-bitrate="formatBitrate"
      :latest-transcription-cache-key="latestTranscriptionCacheKey"
      :latest-transcription-was-cached="latestTranscriptionWasCached"
      :latest-transcription-text="latestTranscriptionText"
    />

    <FileProjectRootSection
      v-if="fileInfo?.kind === 'directory' && isProjectRootDir"
      :is-project-root-dir="isProjectRootDir"
      :project-name="projectStore.currentProjectName"
      :storage-free-bytes="storageFreeBytes"
      :project-stats="projectStats"
    />

    <FileTimelineUsageSection
      v-if="fileInfo?.kind === 'file'"
      :usages="timelinesUsingSelectedFile"
      :open-timeline-from-usage="openTimelineFromUsage"
    />

    <OtioPropertiesSection
      v-if="fileInfo?.kind === 'file' && isOtio"
      :summary="timelineDocSummary"
      :format-duration-seconds="formatDurationSeconds"
    />

    <FileGeneralInfoSection
      v-if="fileInfo && !isProjectRootDir && fileInfo.kind === 'directory'"
      :title="generalInfoTitle"
      :file-info="fileInfo"
      :selected-path="selectedPath"
      :is-hidden="isHidden"
      :format-bytes="formatBytes"
    />

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

    <FileGeneralInfoSection
      v-if="fileInfo && !isProjectRootDir && fileInfo.kind === 'file'"
      :title="generalInfoTitle"
      :file-info="fileInfo"
      :selected-path="selectedPath"
      :is-hidden="isHidden"
      :format-bytes="formatBytes"
    >
      <template v-if="mediaType === 'text' && lineCount !== null">
        <PropertyRow :label="t('fastcat.file.lineCount', 'Line Count')" :value="lineCount" />
      </template>
    </FileGeneralInfoSection>

    <ExpandableYamlSection
      v-if="fileInfo?.kind === 'file' && (isVideoFile || isAudioFile) && metadataYaml"
      :title="t('common.meta', 'Meta')"
      :content="metadataYaml"
      :expanded="isMetaExpanded"
      :on-toggle="() => (isMetaExpanded = !isMetaExpanded)"
      :on-copy="copyToClipboard"
    />

    <ExpandableYamlSection
      v-if="fileInfo?.kind === 'file' && mediaType === 'image' && exifYaml"
      title="EXIF"
      :content="exifYaml"
      :expanded="isExifExpanded"
      :on-toggle="() => (isExifExpanded = !isExifExpanded)"
      :on-copy="copyToClipboard"
    />

    <FileTranscriptionModal
      v-model:is-transcription-modal-open="isTranscriptionModalOpen"
      v-model:transcription-language="transcriptionLanguage"
      :is-transcribing-audio="isTranscribingAudio"
      :transcription-error="transcriptionError"
      @submit="submitAudioTranscription"
    />
  </div>
</template>
