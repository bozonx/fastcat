<script setup lang="ts">
import { ref, computed } from 'vue';
import { useMediaStore } from '~/stores/media.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { formatBytes, formatBitrate, formatDurationSeconds } from '~/utils/format';
import { BROWSER_NATIVE_IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '~/utils/media-types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import EntryPreviewBox from '~/components/properties/file/EntryPreviewBox.vue';
import MediaPropertiesSection from '~/components/properties/file/MediaPropertiesSection.vue';
import ExpandableYamlSection from '~/components/properties/file/ExpandableYamlSection.vue';
import FileGeneralInfoSection from '~/components/properties/file/FileGeneralInfoSection.vue';
import FileTimelineUsageSection from '~/components/properties/file/FileTimelineUsageSection.vue';
import type {
  RemoteVfsFileEntry,
  RemoteVfsEntry,
  RemoteVfsDirectoryEntry,
} from '~/types/remote-vfs';
import type { BloggerDogEntryPayload } from '~/types/bloggerdog';
import ImageFilePropertiesSection from '~/components/properties/file/ImageFilePropertiesSection.vue';
import OtioPropertiesSection from '~/components/properties/file/OtioPropertiesSection.vue';
import FileProjectRootSection from '~/components/properties/file/FileProjectRootSection.vue';
import FileTranscriptionModal from '~/components/file-manager/modals/FileTranscriptionModal.vue';
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
import { useComputerVfs } from '~/composables/file-manager/useComputerVfs';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { isWorkspaceCommonPath, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import type {
  PrimaryEntryAction,
  SecondaryEntryAction,
} from '~/composables/properties/useFilePropertiesActions';
import type { FsEntry } from '~/types/fs';

const props = defineProps<{
  selectedFsEntry: FsEntry;
  previewMode: 'original' | 'proxy';
  hasProxy?: boolean;
  instanceId?: string;
  selectionOrigin?: 'project-manager' | 'workspace-browser' | 'remote-browser';
  isExternal?: boolean;
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
const selectionStore = useSelectionStore();
const workspaceStore = useWorkspaceStore();
const toast = useToast();
const { extractAudio } = useAudioExtraction();
const fileManager = useFileManager();
const { vfs: computerVfs } = useComputerVfs();
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

// canUploadToRemote removed

const sttConfig = computed(() =>
  resolveExternalServiceConfig({
    service: 'stt',
    integrations: workspaceStore.userSettings.integrations,
    bloggerDogApiUrl: '',
    fastcatAccountApiUrl: runtimeConfig.public.fastcatAccountApiUrl as string,
  }),
);

const uploadInputRef = ref<HTMLInputElement | null>(null);

const selectedFsEntryRef = computed(() => props.selectedFsEntry);
const previewModeRef = computed(() => props.previewMode);
const hasProxyRef = computed(() => props.hasProxy);
const isRemoteEntry = computed(() => props.selectedFsEntry?.source === 'remote');
const hasAbsoluteLocalPath = computed(() => {
  if (isRemoteEntry.value) return false;
  const path = props.selectedFsEntry?.path;
  if (typeof path !== 'string' || path.length === 0) return false;
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
});
const isExternalContext = computed(
  () =>
    (!isRemoteEntry.value && props.isExternal) ||
    (!isRemoteEntry.value &&
      (props.selectionOrigin === 'workspace-browser' ||
        props.selectionOrigin === 'remote-browser' ||
        props.instanceId === 'computer' ||
        props.instanceId === 'sidebar' ||
        hasAbsoluteLocalPath.value)),
);
const isRootDirectory = computed(() => {
  const entry = props.selectedFsEntry;
  return entry?.kind === 'directory' && (entry.path === '' || entry.path === '/');
});
const isWorkspaceRootProperties = computed(
  () =>
    isRootDirectory.value && isExternalContext.value && props.selectedFsEntry?.kind === 'directory',
);
const effectiveVfs = computed(() =>
  isExternalContext.value ? (computerVfs.value ?? fileManager.vfs) : fileManager.vfs,
);

const { isProjectRootDir, storageFreeBytes, projectStats } = useFileStorageInfo({
  selectedFsEntry: selectedFsEntryRef,
  currentProjectName: computed(() => projectStore.currentProjectName),
  getDirectoryHandleByPath: async (path) =>
    isExternalContext.value ? null : await projectStore.getDirectoryHandleByPath(path),
});

const isProjectRootDirInContext = computed(
  () => isProjectRootDir.value && !isExternalContext.value,
);

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
  return (
    entry?.source === 'remote' &&
    (path === '' || path === '/' || path === '/remote' || path === '/remote/')
  );
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
    await fileManager.handleFiles(files, { targetDirPath: entry.path });
  }
  await fileManager.loadProjectDirectory();
  uiStore.notifyFileManagerUpdate();
}

const isVirtualAll = computed(() => {
  const entry = props.selectedFsEntry;
  return entry?.source === 'remote' && (entry as any).remoteId === 'virtual-all';
});

const isPersonalLibrary = computed(() => {
  const entry = props.selectedFsEntry;
  return entry?.source === 'remote' && (entry as any).remoteId === 'personal';
});

const isProjectLibraries = computed(() => {
  const entry = props.selectedFsEntry;
  return entry?.source === 'remote' && (entry as any).remoteId === 'projects';
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
  thumbnailUrl,
} = useEntryPreview({
  selectedFsEntry: selectedFsEntryRef,
  previewMode: previewModeRef,
  hasProxy: hasProxyRef,
  mediaStore,
  proxyStore,
  getFileByPath: (path) => effectiveVfs.value.getFile(path),
  getMetadata: async ({ file, path }) => {
    if (isExternalContext.value) {
      return await mediaStore.getOrFetchMetadata(file, `external:${path}`, {
        forceRefresh: true,
      });
    }
    return await mediaStore.getOrFetchMetadataByPath(path, {
      forceRefresh: true,
    });
  },
  getDirectoryHandleByPath: (path) =>
    isExternalContext.value ? Promise.resolve(null) : projectStore.getDirectoryHandleByPath(path),
  onResetPreviewMode: (mode) => emit('update:previewMode', mode),
});

const {
  generalInfoTitle,
  isHidden,
  mediaMeta,
  selectedPath,
  isBloggerDogProject,
  isBloggerDogGroup,
  isBloggerDogContentItem,
  isBloggerDogMedia,
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

const isVideoWithAudio = computed(() => Boolean(mediaMeta.value?.audio));

const isFormatUnsupported = computed(() =>
  Boolean(selectedPath.value && mediaStore.metadataLoadFailed[selectedPath.value]),
);

const isVideoCodecUnsupported = computed(() => mediaMeta.value?.video?.canDecode === false);

const isAudioCodecUnsupported = computed(() => mediaMeta.value?.audio?.canDecode === false);

const isImageUnsupported = computed(() => {
  if (mediaType.value !== 'image') return false;
  const ext = props.selectedFsEntry?.name.split('.').pop()?.toLowerCase() ?? '';
  if (
    BROWSER_NATIVE_IMAGE_EXTENSIONS.includes(ext) &&
    mediaMeta.value?.image?.canDisplay === false
  ) {
    return true;
  }
  return false;
});

const isMediaFullyUnsupported = computed(
  () => isFormatUnsupported.value || isVideoCodecUnsupported.value || isImageUnsupported.value,
);

const showPreviewSection = computed(() => {
  if (fileInfo.value?.kind === 'directory' || isRemoteRoot.value) return false;
  return (
    mediaType.value === 'image' ||
    mediaType.value === 'video' ||
    mediaType.value === 'audio' ||
    (mediaType.value === 'text' && !isOtio.value)
  );
});

const isRemoteContent = computed(
  () =>
    isBloggerDogContentItem.value ||
    isBloggerDogGroup.value ||
    isBloggerDogProject.value ||
    isBloggerDogMedia.value,
);

const castedRemoteRecord = computed(() => {
  if (!isRemoteContent.value || !props.selectedFsEntry?.adapterPayload) return null;
  const payload = props.selectedFsEntry.adapterPayload as BloggerDogEntryPayload;
  return payload?.remoteData as RemoteVfsEntry | undefined;
});

const remoteMediaCount = computed(() => {
  if (fileInfo.value?.kind === 'file') return undefined;
  const record = castedRemoteRecord.value;
  if (record && 'media' in record) {
    return (record as RemoteVfsFileEntry).media?.length;
  }
  return undefined;
});

const remoteItemsCount = computed(() => {
  const record = castedRemoteRecord.value;
  if (record && 'itemsCount' in record) {
    return (record as RemoteVfsDirectoryEntry).itemsCount;
  }
  return undefined;
});

const showVideoProxyActions = computed(() => {
  if (isRootDirectory.value || isExternalContext.value) return false;
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
  isSttModelReady,
  openTranscriptionModal,
  submitAudioTranscription,
} = useFilePropertiesTranscription({
  selectedFsEntry: selectedFsEntryRef,
  isAudioFile,
  isVideoFile,
  sttConfig,
  workspaceHandle: computed(() => workspaceStore.workspaceHandle),
  userSettings: computed(() => workspaceStore.userSettings),
  fastcatAccountApiUrl: computed(() =>
    typeof runtimeConfig.public.fastcatAccountApiUrl === 'string'
      ? runtimeConfig.public.fastcatAccountApiUrl
      : '',
  ),
  currentProjectName: computed(() => projectStore.currentProjectName),
  getFileByPath: (path) => projectStore.getFileByPath(path),
  isSttModelDownloaded: computed(() => workspaceStore.isSttModelDownloaded),
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
} = useFilePropertiesHandlers({
  selectedFsEntry: selectedFsEntryRef,
  mediaType,
  textContent,
  isExternalContext,
});

const canCopyOrCut = computed(() => {
  return !isRootDirectory.value && !isCommonRoot.value;
});

function onCopy() {
  const entry = props.selectedFsEntry;
  if (!entry || !entry.path) return;
  const sourceInstanceId =
    selectionStore.selectedEntity?.source === 'fileManager'
      ? selectionStore.selectedEntity.instanceId
      : undefined;
  clipboardStore.setClipboardPayload({
    source: 'fileManager',
    operation: 'copy',
    items: [
      {
        path: entry.path,
        kind: entry.kind,
        name: entry.name,
        source: entry.source,
      },
    ],
    sourceInstanceId,
  });
}

function onCut() {
  const entry = props.selectedFsEntry;
  if (!entry || !entry.path) return;
  const sourceInstanceId =
    selectionStore.selectedEntity?.source === 'fileManager'
      ? selectionStore.selectedEntity.instanceId
      : undefined;
  clipboardStore.setClipboardPayload({
    source: 'fileManager',
    operation: 'cut',
    items: [
      {
        path: entry.path,
        kind: entry.kind,
        name: entry.name,
        source: entry.source,
      },
    ],
    sourceInstanceId,
  });
}

function onPaste() {
  const entry = props.selectedFsEntry;
  if (!entry || entry.kind !== 'directory') return;
  uiStore.pendingFsEntryPaste = entry;
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
  isProjectRootDir: isRootDirectory,
  isRemoteRoot,
  isFolderWithVideo,
  isGeneratingProxyForFolder,
  canConvertFile,
  canTranscribeMedia,
  isAudioFile,
  canOpenAsPanel,
  canOpenAsProjectTab,
  showVideoProxyActions,
  hasExistingProxyForFile,
  isGeneratingProxyForFile,
  isOtio,
  isVideoFile,
  isVideoWithAudio,
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
  createContentItem: () => {
    const entry = props.selectedFsEntry;
    if (!entry || entry.kind !== 'directory') return;
    (uiStore as any).pendingBloggerDogCreateItem = entry;
  },
  onCopy,
  onCut,
  onPaste,
  isBloggerDogProject,
  isBloggerDogGroup,
  isBloggerDogContentItem,
  isVirtualAll,
  isPersonalLibrary,
  instanceId: computed(() => props.instanceId),
  isExternal: isExternalContext,
});

const filteredDirectoryPrimaryActions = computed(() => {
  if (isPersonalLibrary.value) return [];

  if (!isRemoteContent.value) {
    return directoryPrimaryActions.value.filter(
      (a: PrimaryEntryAction) => !['createSubgroup', 'createContentItem'].includes(a.id),
    );
  }

  return directoryPrimaryActions.value;
});

const filteredFilePrimaryActions = computed(() => {
  return filePrimaryActions.value;
});

const filteredFileSecondaryActions = computed<SecondaryEntryAction[]>(() => {
  if (!isExternalContext.value) return fileSecondaryActions.value;

  return fileSecondaryActions.value.filter(
    (action) =>
      action.id !== 'openAsPanelCut' &&
      action.id !== 'openAsPanelSound' &&
      action.id !== 'openAsProjectTab',
  );
});

const virtualAllPrimaryActions = computed<PrimaryEntryAction[]>(() =>
  directoryPrimaryActions.value.filter((action) => action.id === 'paste'),
);

const virtualAllSecondaryActions = computed<SecondaryEntryAction[]>(() =>
  directorySecondaryActions.value.filter((action) => action.id === 'createContentItem'),
);

const personalLibraryPrimaryActions = computed<PrimaryEntryAction[]>(() =>
  directoryPrimaryActions.value.filter((action) => action.id === 'paste'),
);

const projectPrimaryActions = computed<PrimaryEntryAction[]>(() =>
  directoryPrimaryActions.value.filter((action) => action.id === 'paste'),
);

const projectSecondaryActions = computed<SecondaryEntryAction[]>(() =>
  directorySecondaryActions.value
    .filter((action) => action.id === 'createContentItem' || action.id === 'createSubgroup')
    .map((action) =>
      action.id === 'createSubgroup'
        ? {
            ...action,
            label: t('fastcat.bloggerDog.actions.createGroup'),
          }
        : action,
    ),
);

const workspaceRootPrimaryActions = computed<PrimaryEntryAction[]>(() => [
  {
    id: 'paste',
    title: t('common.paste', 'Paste'),
    icon: 'i-heroicons-clipboard',
    disabled: !hasClipboardItems.value,
    onClick: onPaste,
  },
]);

const workspaceRootSecondaryActions = computed<SecondaryEntryAction[]>(() => [
  {
    id: 'createSubfolder',
    label: t('videoEditor.fileManager.actions.createFolder'),
    icon: 'i-heroicons-folder-plus',
    onClick: createSubfolder,
  },
  {
    id: 'createMarkdown',
    label: t('videoEditor.fileManager.actions.createMarkdown'),
    icon: 'i-heroicons-document-text',
    onClick: createMarkdownInFolder,
  },
]);
</script>

<template>
  <!-- IMPORTANT: NO LOADING INDICATORS ALLOWED HERE. ALL PROPERTIES MUST LOAD SILENTLY. -->
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
      v-else-if="showPreviewSection"
      :selected-entry-kind="selectedFsEntry?.kind ?? null"
      :is-unknown="isUnknown"
      :is-corrupt="isMediaFullyUnsupported"
      :current-url="currentUrl"
      :media-type="mediaType"
      :text-content="textContent"
      :file-path="selectedFsEntry?.path"
      :file-name="selectedFsEntry?.name"
      :thumbnail-url="thumbnailUrl"
      :is-otio="isOtio"
      :class="[mobileTextMode && mediaType === 'text' ? 'flex-1 border-none' : '']"
    />

    <template v-if="!mobileTextMode || mediaType !== 'text'">
      <PropertySection
        v-if="isWorkspaceRootProperties"
        key="actions-workspace-root"
        :title="t('videoEditor.fileManager.actions.title', 'Actions')"
      >
        <EntryActions
          :primary-actions="workspaceRootPrimaryActions"
          :secondary-actions="workspaceRootSecondaryActions"
        />
      </PropertySection>

      <ImageFilePropertiesSection
        v-if="
          !isWorkspaceRootProperties &&
          (fileInfo?.kind === 'file' || selectedFsEntry?.kind === 'file') &&
          mediaType === 'image' &&
          hasImageInfo
        "
        :image-resolution="imageResolution"
        :image-create-date="imageCreateDate"
        :image-location-link="imageLocationLink"
        :image-camera-make="imageCameraMake"
      />

      <MediaPropertiesSection
        v-if="
          !isWorkspaceRootProperties &&
          (fileInfo?.kind === 'file' || selectedFsEntry?.kind === 'file') &&
          (isVideoFile || mediaType === 'audio')
        "
        :media-meta="mediaMeta"
        :format-duration-seconds="formatDurationSeconds"
        :format-bitrate="formatBitrate"
        :latest-transcription-cache-key="latestTranscriptionCacheKey"
        :latest-transcription-was-cached="latestTranscriptionWasCached"
        :latest-transcription-text="latestTranscriptionText"
      />

      <OtioPropertiesSection
        v-if="
          !isWorkspaceRootProperties &&
          (fileInfo?.kind === 'file' || selectedFsEntry?.kind === 'file') &&
          isOtio
        "
        :summary="timelineDocSummary"
        :format-duration-seconds="formatDurationSeconds"
      />

      <BloggerDogItemPropertiesSection
        v-if="!isWorkspaceRootProperties && isBloggerDogContentItem && castedRemoteRecord"
        :item="castedRemoteRecord as RemoteVfsFileEntry"
        :config="remoteFilesConfig!"
        :title="generalInfoTitle"
      />

      <PropertySection
        v-if="
          !isWorkspaceRootProperties &&
          !hideActions &&
          fileInfo &&
          fileInfo.kind === 'directory' &&
          !isRemoteRoot &&
          !isVirtualAll &&
          !isProjectLibraries &&
          !isBloggerDogProject
        "
        key="actions-directory"
        :title="t('videoEditor.fileManager.actions.title', 'Actions')"
      >
        <EntryActions
          :primary-actions="filteredDirectoryPrimaryActions"
          :secondary-actions="directorySecondaryActions"
        />
      </PropertySection>

      <PropertySection
        v-else-if="
          !isWorkspaceRootProperties &&
          !hideActions &&
          (fileInfo?.kind === 'file' || selectedFsEntry?.kind === 'file') &&
          !isVirtualAll &&
          !isPersonalLibrary &&
          !isProjectLibraries &&
          !isBloggerDogProject
        "
        key="actions-file"
        :title="t('videoEditor.fileManager.actions.title', 'Actions')"
      >
        <EntryActions
          :primary-actions="filteredFilePrimaryActions"
          :secondary-actions="filteredFileSecondaryActions"
        />
      </PropertySection>

      <FileProjectRootSection
        v-if="
          !isWorkspaceRootProperties && fileInfo?.kind === 'directory' && isProjectRootDirInContext
        "
        :is-project-root-dir="isProjectRootDir"
        :project-name="projectStore.currentProjectName"
        :storage-free-bytes="storageFreeBytes"
        :project-stats="projectStats"
      />

      <template v-if="isRemoteRoot">
        <PropertySection :title="t('fastcat.bloggerDog.contentLibrary', 'Библиотека контента')">
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

      <PropertySection
        v-if="!isWorkspaceRootProperties && isVirtualAll"
        :title="t('fastcat.bloggerDog.allContent', 'Весь контент')"
      >
        <div class="text-xs text-ui-text-muted italic px-2 py-1 mb-2">
          {{
            t(
              'fastcat.bloggerDog.virtualAllDesc',
              'Виртуальный плосский список всех элементов контента',
            )
          }}
        </div>
        <PropertyRow v-if="bloggerDogDeepLink" :label="t('common.path', 'Путь')">
          <a
            :href="bloggerDogDeepLink"
            target="_blank"
            class="text-primary-500 hover:text-primary-400 underline decoration-dotted transition-colors flex items-center gap-1 overflow-hidden"
          >
            <span class="truncate">{{ bloggerDogDeepLink }}</span>
            <UIcon name="i-heroicons-arrow-top-right-on-square-20-solid" class="w-3 h-3 shrink-0" />
          </a>
        </PropertyRow>
      </PropertySection>

      <PropertySection
        v-if="!isWorkspaceRootProperties && !hideActions && isVirtualAll"
        :title="t('videoEditor.fileManager.actions.title')"
      >
        <EntryActions
          :primary-actions="virtualAllPrimaryActions"
          :secondary-actions="virtualAllSecondaryActions"
        />
      </PropertySection>

      <PropertySection
        v-if="!isWorkspaceRootProperties && isPersonalLibrary"
        :title="t('fastcat.bloggerDog.personalLibrary', 'Личная библиотека')"
      >
        <div class="text-xs text-ui-text-muted italic px-2 py-1 mb-2">
          {{ t('fastcat.bloggerDog.personalLibraryDesc', 'Библиотека вашего личного контента') }}
        </div>
        <PropertyRow v-if="bloggerDogDeepLink" :label="t('common.path', 'Путь')">
          <a
            :href="bloggerDogDeepLink"
            target="_blank"
            class="text-primary-500 hover:text-primary-400 underline decoration-dotted transition-colors flex items-center gap-1 overflow-hidden"
          >
            <span class="truncate">{{ bloggerDogDeepLink }}</span>
            <UIcon name="i-heroicons-arrow-top-right-on-square-20-solid" class="w-3 h-3 shrink-0" />
          </a>
        </PropertyRow>
      </PropertySection>

      <PropertySection
        v-if="!isWorkspaceRootProperties && !hideActions && isPersonalLibrary"
        :title="t('videoEditor.fileManager.actions.title')"
      >
        <EntryActions :primary-actions="personalLibraryPrimaryActions" :secondary-actions="[]" />
      </PropertySection>

      <PropertySection
        v-if="!isWorkspaceRootProperties && isProjectLibraries"
        :title="t('fastcat.bloggerDog.projectLibraries', 'Библиотеки проектов')"
      >
        <div class="text-xs text-ui-text-muted italic px-2 py-1 mb-2">
          {{
            t('fastcat.bloggerDog.projectLibrariesDesc', 'Библиотеки контента конкретных проектов')
          }}
        </div>
        <PropertyRow v-if="bloggerDogDeepLink" :label="t('common.path', 'Путь')">
          <a
            :href="bloggerDogDeepLink"
            target="_blank"
            class="text-primary-500 hover:text-primary-400 underline decoration-dotted transition-colors flex items-center gap-1 overflow-hidden"
          >
            <span class="truncate">{{ bloggerDogDeepLink }}</span>
            <UIcon name="i-heroicons-arrow-top-right-on-square-20-solid" class="w-3 h-3 shrink-0" />
          </a>
        </PropertyRow>
      </PropertySection>

      <PropertySection
        v-if="!isWorkspaceRootProperties && isBloggerDogProject"
        :title="generalInfoTitle"
      >
        <PropertyRow v-if="selectedPath" :label="t('common.path', 'Путь')">
          <a
            v-if="bloggerDogDeepLink"
            :href="bloggerDogDeepLink"
            target="_blank"
            class="text-primary-500 hover:text-primary-400 underline decoration-dotted transition-colors flex items-center gap-1 overflow-hidden"
          >
            <span class="truncate"
              >/projects/{{ castedRemoteRecord?.id || selectedFsEntry?.name }}</span
            >
            <UIcon name="i-heroicons-arrow-top-right-on-square-20-solid" class="w-3 h-3 shrink-0" />
          </a>
          <span v-else>{{ selectedPath }}</span>
        </PropertyRow>
      </PropertySection>

      <PropertySection
        v-if="!isWorkspaceRootProperties && !hideActions && isBloggerDogProject"
        :title="t('videoEditor.fileManager.actions.title')"
      >
        <EntryActions
          :primary-actions="projectPrimaryActions"
          :secondary-actions="projectSecondaryActions"
        />
      </PropertySection>

      <FileGeneralInfoSection
        v-if="
          !isWorkspaceRootProperties &&
          selectedFsEntry &&
          !isProjectRootDirInContext &&
          selectedFsEntry.kind === 'file'
        "
        :title="generalInfoTitle"
        :file-info="fileInfo || (selectedFsEntry as any)"
        :selected-path="selectedPath"
        :is-hidden="isHidden"
        :format-bytes="formatBytes"
        :media-count="remoteMediaCount"
        :instance-id="props.instanceId"
        :is-external="isExternalContext"
        :hide-header="(props.selectedFsEntry as any)?.mimeType === 'application/octet-stream'"
      >
        <template v-if="mediaType === 'text' && lineCount !== null">
          <PropertyRow :label="t('fastcat.file.lineCount', 'Line Count')" :value="lineCount" />
        </template>
      </FileGeneralInfoSection>

      <FileTimelineUsageSection
        v-if="!isWorkspaceRootProperties && selectedFsEntry.kind === 'file' && !isExternalContext"
        :usages="timelinesUsingSelectedFile"
        :open-timeline-from-usage="openTimelineFromUsage"
      />

      <FileGeneralInfoSection
        v-if="
          !isWorkspaceRootProperties &&
          selectedFsEntry &&
          !isProjectRootDirInContext &&
          selectedFsEntry.kind === 'directory' &&
          !isRemoteRoot &&
          !isVirtualAll &&
          !isPersonalLibrary &&
          !isProjectLibraries &&
          !isBloggerDogProject &&
          !isBloggerDogContentItem
        "
        :title="generalInfoTitle"
        :file-info="fileInfo || (selectedFsEntry as any)"
        :selected-path="selectedPath"
        :path-link="bloggerDogDeepLink"
        :is-hidden="isHidden"
        :format-bytes="formatBytes"
        :media-count="remoteMediaCount"
        :instance-id="props.instanceId"
        :is-external="isExternalContext"
      >
        <template v-if="selectedFsEntry?.source === 'remote' && remoteItemsCount !== undefined">
          <PropertyRow
            :label="t('fastcat.file.itemsCount', 'Количество элементов')"
            :value="remoteItemsCount"
          />
        </template>
      </FileGeneralInfoSection>

      <!-- General info for files moved to top -->

      <ExpandableYamlSection
        v-if="
          !isWorkspaceRootProperties &&
          (fileInfo?.kind === 'file' || selectedFsEntry?.kind === 'file') &&
          (isVideoFile || isAudioFile) &&
          metadataYaml &&
          !['{}', '[]', 'null', ''].includes(metadataYaml.trim())
        "
        :title="t('common.meta', 'Meta')"
        :content="metadataYaml"
        :expanded="isMetaExpanded"
        :on-toggle="() => (isMetaExpanded = !isMetaExpanded)"
        :on-copy="copyToClipboard"
      />

      <ExpandableYamlSection
        v-if="
          !isWorkspaceRootProperties &&
          (fileInfo?.kind === 'file' || selectedFsEntry?.kind === 'file') &&
          mediaType === 'image' &&
          exifYaml &&
          !['{}', '[]', 'null', ''].includes(exifYaml.trim())
        "
        title="EXIF"
        :content="exifYaml"
        :expanded="isExifExpanded"
        :on-toggle="() => (isExifExpanded = !isExifExpanded)"
        :on-copy="copyToClipboard"
      />

      <FileTranscriptionModal
        v-model:open="isTranscriptionModalOpen"
        v-model:transcription-language="transcriptionLanguage"
        :is-transcribing="isTranscribingAudio"
        :is-model-ready="isSttModelReady"
        :transcription-error="transcriptionError"
        @submit="submitAudioTranscription"
      />
    </template>
  </div>
</template>
