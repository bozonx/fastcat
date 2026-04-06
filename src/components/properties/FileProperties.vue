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
import type { RemoteVfsFileEntry } from '~/types/remote-vfs';
import ImageFilePropertiesSection from '~/components/properties/file/ImageFilePropertiesSection.vue';
import OtioPropertiesSection from '~/components/properties/file/OtioPropertiesSection.vue';
import FileProjectRootSection from '~/components/properties/file/FileProjectRootSection.vue';
import FileTranscriptionModal from '~/components/properties/file/FileTranscriptionModal.vue';
import EntryActions from '~/components/properties/file/EntryActions.vue';
import BloggerDogItemPropertiesSection from '~/components/properties/file/BloggerDogItemPropertiesSection.vue';
import { useEntryPreview } from '~/composables/file-manager/useEntryPreview';
import { useImageExifInfo } from '~/composables/properties/useImageExifInfo';
import { useFileTimelineUsage } from '~/composables/properties/useFileTimelineUsage';
import { useFileProxyFolder } from '~/composables/properties/useFileProxyFolder';
import { useFilePropertiesBasics } from '~/composables/properties/useFilePropertiesBasics';
import { useFilePropertiesActions } from '~/composables/properties/useFilePropertiesActions';
import { useFilePropertiesTranscription } from '~/composables/properties/useFilePropertiesTranscription';
import { useFileStorageInfo } from '~/composables/properties/useFileStorageInfo';
import { useFilePropertiesHandlers } from '~/composables/properties/useFilePropertiesHandlers';
import { useAudioExtraction } from '~/composables/file-manager/useAudioExtraction';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { isWorkspaceCommonPath, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import type { PrimaryEntryAction } from '~/composables/properties/useFilePropertiesActions';
import type { FsEntry } from '~/types/fs';

const props = defineProps<{
  selectedFsEntry: FsEntry;
  previewMode: 'original' | 'proxy';
  hasProxy: boolean;
  isFilesPage?: boolean;
  mobileTextMode?: boolean;
  hideActions?: boolean;
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
    bloggerDogApiUrl:
      typeof runtimeConfig.public.bloggerDogApiUrl === 'string'
        ? runtimeConfig.public.bloggerDogApiUrl
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
    bloggerDogApiUrl: '', // BloggerDog removed for STT
    fastcatAccountApiUrl: runtimeConfig.public.fastcatAccountApiUrl as string,
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

const isRemoteRoot = computed(() => {
  const entry = props.selectedFsEntry;
  const path = entry?.path || '';
  return entry?.source === 'remote' && (path === '' || path === '/' || path === '/remote' || path === '/remote/');
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

const isVirtualAll = computed(() => {
  const entry = props.selectedFsEntry;
  return entry?.source === 'remote' && (entry as any).remoteId === 'virtual-all';
});

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

const { 
  generalInfoTitle, 
  isHidden, 
  mediaMeta, 
  selectedPath,
  isBloggerDogGroup,
  isBloggerDogContentItem,
  bloggerDogDeepLink,
} = useFilePropertiesBasics({
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

const isFormatUnsupported = computed(() =>
  Boolean(selectedPath.value && mediaStore.metadataLoadFailed[selectedPath.value]),
);

const isVideoCodecUnsupported = computed(() => mediaMeta.value?.video?.canDecode === false);

const isAudioCodecUnsupported = computed(() => mediaMeta.value?.audio?.canDecode === false);

const isImageUnsupported = computed(() => {
  if (mediaType.value !== 'image') return false;
  // If we have metadata and it explicitly says it's not displayable
  if (mediaMeta.value?.image?.canDisplay === false) return true;
  // If we have metadata but no image info at all (rare, but possible if corrupted)
  if (mediaMeta.value && !mediaMeta.value.image) return true;
  return false;
});

const isMediaFullyUnsupported = computed(
  () => isFormatUnsupported.value || isVideoCodecUnsupported.value || isImageUnsupported.value,
);

const isRemoteContent = computed(() => isBloggerDogContentItem.value || isBloggerDogGroup.value);

const castedRemoteRecord = computed(() => {
  if (!isRemoteContent.value || !props.selectedFsEntry?.remoteData) return null;
  return props.selectedFsEntry.remoteData as RemoteVfsFileEntry;
});

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
  if (isMediaFullyUnsupported.value) return false;
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
  fastcatAccountApiUrl: computed(() =>
    typeof runtimeConfig.public.fastcatAccountApiUrl === 'string'
      ? runtimeConfig.public.fastcatAccountApiUrl
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
  isRemoteRoot,
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
  isRemoteMode: computed(() => props.selectedFsEntry?.source === 'remote'),
  isRemoteAvailable: computed(() => Boolean(remoteFilesConfig.value)),
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
  createSubgroup: () => {
    const entry = props.selectedFsEntry;
    if (!entry || entry.kind !== 'directory') return;
    (uiStore as any).pendingBloggerDogCreateSubgroup = entry;
  },
  onCopy,
  onCut,
  onPaste,
});

const isRemoteAvailable = computed(() => Boolean(remoteFilesConfig.value));
const isRemoteMode = computed(() => props.selectedFsEntry?.source === 'remote');

const filteredDirectoryPrimaryActions = computed(() => {
  if (!isRemoteContent.value) return directoryPrimaryActions.value;
  return directoryPrimaryActions.value.filter((a: PrimaryEntryAction) => ['rename', 'delete', 'createSubgroup'].includes(a.id));
});

const filteredFilePrimaryActions = computed(() => {
  if (!isRemoteContent.value) return filePrimaryActions.value;
  return filePrimaryActions.value.filter((a: PrimaryEntryAction) => ['rename', 'delete'].includes(a.id));
});
</script>

<template>
  <div class="w-full flex flex-col" :class="mobileTextMode ? 'h-full gap-0' : 'gap-4'">
    <input
      ref="uploadInputRef"
      type="file"
      multiple
      class="hidden"
      @change="onDirectoryFileSelect"
    />

    <div
      v-if="fileInfo?.kind !== 'directory' && isMediaFullyUnsupported"
      class="flex flex-col gap-2 p-3 rounded-lg bg-red-950/40 border border-red-800/50 text-sm"
    >
      <div class="flex items-center gap-2 text-red-400 font-medium">
        <UIcon name="i-heroicons-exclamation-triangle" class="w-4 h-4 shrink-0" />
        <span>{{ t('videoEditor.fileManager.compatibility.unsupportedTitle') }}</span>
      </div>
      <ul class="flex flex-col gap-1 pl-6 text-red-300/80">
        <li v-if="isImageUnsupported">
          {{ t('videoEditor.fileManager.compatibility.imageFormatUnsupported') }}
        </li>
        <li v-if="isFormatUnsupported">
          {{ t('videoEditor.fileManager.compatibility.formatUnsupported') }}
        </li>
        <li v-if="isVideoCodecUnsupported">
          {{ t('videoEditor.fileManager.compatibility.videoCodecUnsupported') }}
          <span v-if="mediaMeta?.video" class="opacity-60">
            ({{ mediaMeta.video.parsedCodec || mediaMeta.video.codec }})
          </span>
        </li>
        <li v-if="isAudioCodecUnsupported">
          {{ t('videoEditor.fileManager.compatibility.audioCodecUnsupported') }}
          <span v-if="mediaMeta?.audio" class="opacity-60">
            ({{ mediaMeta.audio.parsedCodec || mediaMeta.audio.codec }})
          </span>
        </li>
      </ul>
    </div>
    <EntryPreviewBox
      v-else-if="fileInfo?.kind !== 'directory' && !isRemoteRoot"
      :selected-entry-kind="selectedFsEntry?.kind ?? null"
      :is-unknown="isUnknown"
      :is-corrupt="isMediaFullyUnsupported"
      :current-url="currentUrl"
      :media-type="mediaType"
      :text-content="textContent"
      :file-path="selectedFsEntry?.path"
      :file-name="selectedFsEntry?.name"
      :is-otio="isOtio"
      :class="mobileTextMode && mediaType === 'text' ? 'flex-1 border-none' : ''"
    />

    <template v-if="isRemoteRoot">
      <PropertySection
        :title="t('fastcat.bloggerDog.contentLibrary', 'Библиотека контента')"
      >
        <PropertyRow :label="t('fastcat.bloggerDog.connection', 'Соединение')">
          <div class="flex items-center gap-2 text-green-400">
            <span>{{ t('fastcat.bloggerDog.connected', 'Установлено') }}</span>
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-heroicons-cog-6-tooth"
              size="2xs"
              class="-my-1"
              @click="uiStore.showIntegrationSettings()"
            />
          </div>
        </PropertyRow>
      </PropertySection>
    </template>

    <template v-if="!mobileTextMode || mediaType !== 'text'">
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

      <PropertySection
        v-if="!hideActions && fileInfo && fileInfo.kind === 'directory' && !isRemoteRoot && !isVirtualAll"
        key="actions-directory"
        :title="t('videoEditor.fileManager.actions.title', 'Actions')"
      >
        <EntryActions
          :primary-actions="filteredDirectoryPrimaryActions"
          :secondary-actions="isRemoteContent ? [] : directorySecondaryActions"
        />
      </PropertySection>

      <PropertySection
        v-else-if="!hideActions && fileInfo?.kind === 'file' && !isVirtualAll"
        key="actions-file"
        :title="t('videoEditor.fileManager.actions.title', 'Actions')"
      >
        <EntryActions
          :primary-actions="filteredFilePrimaryActions"
          :secondary-actions="isRemoteContent ? [] : fileSecondaryActions"
        />
      </PropertySection>

      <BloggerDogItemPropertiesSection
        v-if="isBloggerDogContentItem && castedRemoteRecord"
        :item="castedRemoteRecord"
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




      <PropertySection
        v-if="isVirtualAll"
        :title="t('fastcat.bloggerDog.allContent', 'Весь контент')"
      >
         <div class="text-xs text-ui-text-muted italic px-2 py-1">
           {{ t('fastcat.bloggerDog.virtualAllDesc', 'Виртуальный плосский список всех элементов контента') }}
         </div>
      </PropertySection>

      <FileGeneralInfoSection
        v-if="fileInfo && !isProjectRootDir && fileInfo.kind === 'directory' && !isRemoteRoot && !isVirtualAll"
        :title="generalInfoTitle"
        :file-info="fileInfo"
        :selected-path="selectedPath"
        :path-link="bloggerDogDeepLink"
        :is-hidden="isHidden"
        :format-bytes="formatBytes"
        :media-count="castedRemoteRecord?.media?.length"
      >
        <template v-if="selectedFsEntry?.source === 'remote' && (selectedFsEntry as any).remoteData?.itemsCount !== undefined">
           <PropertyRow 
             :label="t('fastcat.file.itemsCount', 'Количество элементов')" 
             :value="(selectedFsEntry as any).remoteData.itemsCount" 
           />
        </template>
      </FileGeneralInfoSection>


      <FileGeneralInfoSection
        v-if="fileInfo && !isProjectRootDir && fileInfo.kind === 'file'"
        :title="generalInfoTitle"
        :file-info="fileInfo"
        :selected-path="selectedPath"
        :path-link="bloggerDogDeepLink"
        :is-hidden="isHidden"
        :format-bytes="formatBytes"
        :media-count="castedRemoteRecord?.media?.length"
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
    </template>
  </div>
</template>
