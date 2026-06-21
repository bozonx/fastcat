<script setup lang="ts">
import { createDevLogger } from '~/utils/dev-logger';

import { ref, computed } from 'vue';
import { useMediaStore, type MediaMetadata } from '~/stores/media.store';
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
import type { RemoteVfsFileEntry, RemoteVfsDirectoryEntry } from '~/types/remote-vfs';
import ImageFilePropertiesSection from '~/components/properties/file/ImageFilePropertiesSection.vue';
import OtioPropertiesSection from '~/components/properties/file/OtioPropertiesSection.vue';
import FileProjectRootSection from '~/components/properties/file/FileProjectRootSection.vue';
import FileTranscriptionModal from '~/components/file-manager/modals/FileTranscriptionModal.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import EntryActions from '~/components/properties/file/EntryActions.vue';
import BloggerDogItemPropertiesSection from '~/components/properties/file/BloggerDogItemPropertiesSection.vue';
import BloggerDogCollectionProperties from '~/components/properties/file/BloggerDogCollectionProperties.vue';

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
import { computeDirectoryStatsByPath } from '~/utils/fs';
import { useComputerVfs } from '~/composables/file-manager/useComputerVfs';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import { useMobileLayout } from '~/composables/useMobileLayout';

import { useFilePropertiesContext } from '~/composables/properties/useFilePropertiesContext';
import { useFileMediaSupport } from '~/composables/properties/useFileMediaSupport';
import { useFilePropertiesClipboard } from '~/composables/properties/useFilePropertiesClipboard';
import { useBloggerDogEntryInfo } from '~/composables/properties/useBloggerDogEntryInfo';
import { useFilePropertiesProxy } from '~/composables/properties/useFilePropertiesProxy';
import { useFilePropertiesActionGroups } from '~/composables/properties/useFilePropertiesActionGroups';
import type { FsEntry } from '~/types/fs';

const log = createDevLogger('FileProperties');

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
  'close-drawer': [];
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
const { vfs: computerVfs } = useComputerVfs();
const runtimeConfig = useRuntimeConfig();

const isMetaExpanded = ref(false);
const isExifExpanded = ref(false);
const isRenameModalOpen = ref(false);

async function handleRenameConfirm(newName: string) {
  const entry = props.selectedFsEntry;
  if (!entry) return;
  await fileManager.renameEntry(entry, newName.trim());
  isRenameModalOpen.value = false;
}

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

// Entry context: remote/local, external browsing, root/common classification, VFS.
const {
  isRemoteFileEntry,
  isExternalContext,
  isRootDirectory,
  isWorkspaceRootProperties,
  effectiveVfs,
  metadataCacheKey,
  isCommonRoot,
  isCommonPath,
  isRemoteRoot,
} = useFilePropertiesContext({
  selectedFsEntry: () => props.selectedFsEntry,
  isExternal: () => props.isExternal,
  selectionOrigin: () => props.selectionOrigin,
  instanceId: () => props.instanceId,
  computerVfs,
  fileManagerVfs: () => fileManager.vfs,
});

const { isProjectRootDir, storageFreeBytes, projectStats } = useFileStorageInfo({
  selectedFsEntry: selectedFsEntryRef,
  currentProjectName: computed(() => projectStore.currentProjectName),
  getProjectStats: () =>
    isExternalContext.value
      ? Promise.resolve(null)
      : computeDirectoryStatsByPath(fileManager.vfs, ''),
});

const isProjectRootDirInContext = computed(
  () => isProjectRootDir.value && !isExternalContext.value,
);

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
  getObjectUrlByPath: (path) => effectiveVfs.value.getObjectUrl(path),
  getMetadata: async ({ file, path }) => {
    if (isExternalContext.value || isRemoteFileEntry.value) {
      return await mediaStore.getOrFetchMetadata(file, `external:${path}`);
    }
    return await mediaStore.getOrFetchMetadataByPath(path);
  },
  getDirectoryStats: (path) =>
    isExternalContext.value
      ? Promise.resolve(null)
      : computeDirectoryStatsByPath(fileManager.vfs, path, { recursiveFilesCount: false }),
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

const {
  isVirtualAll,
  isPersonalLibrary,
  isProjectLibraries,
  isRemoteContent,
  castedRemoteRecord,
  remoteMediaCount,
  remoteItemsCount,
} = useBloggerDogEntryInfo({
  selectedFsEntry: () => props.selectedFsEntry,
  fileInfo,
  isBloggerDogContentItem,
  isBloggerDogGroup,
  isBloggerDogProject,
  isBloggerDogMedia,
});

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.add({ title: t('common.copiedToClipboard') });
  } catch (e) {
    log.error('Failed to copy to clipboard', e);
  }
}

// Media type / codec support derivations (preview, unsupported banners, convert).
const {
  isVideoFile,
  isAudioFile,
  isVideoWithAudio,
  isFormatUnsupported,
  isVideoCodecUnsupported,
  isAudioCodecUnsupported,
  isImageUnsupported,
  isMediaFullyUnsupported,
  videoCodecLabel,
  audioCodecLabel,
  canConvertFile,
  showPreviewSection,
} = useFileMediaSupport({
  selectedFsEntry: () => props.selectedFsEntry,
  mediaType,
  mediaMeta,
  fileInfo,
  isOtio,
  isRemoteRoot,
  metadataCacheKey,
  mediaStore,
});

const { showVideoProxyActions, isGeneratingProxyForFile, hasExistingProxyForFile } =
  useFilePropertiesProxy({
    isRootDirectory,
    isExternalContext,
    isVideoFile,
    selectedPath,
    isMediaFullyUnsupported,
  });

const liveMediaMeta = computed((): MediaMetadata | null => {
  const path = selectedPath.value;
  if (!path) return null;
  return (mediaStore.mediaMetadata as Record<string, MediaMetadata | undefined>)[path] ?? null;
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
  onDelete,
  openAsTextPanel,
} = useFilePropertiesHandlers({
  selectedFsEntry: selectedFsEntryRef,
  mediaType,
  textContent,
  isExternalContext,
  isMediaFullyUnsupported,
});

const { canCopy, canCut, onCopy, onCut, onPaste, hasClipboardItems } = useFilePropertiesClipboard({
  selectedFsEntry: () => props.selectedFsEntry,
  isRootDirectory,
  isCommonRoot,
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
  canCopyOrCut: canCopy,
  canCut,
  hasClipboardItems,
  triggerDirectoryUpload,
  createSubfolder,
  createTimelineInFolder,
  createMarkdownInFolder,
  generateProxiesForSelectedFolder: async () => {
    await generateProxiesForSelectedFolder();
    emit('close-drawer');
  },
  stopProxyGenerationForSelectedFolder,
  onRename: () => {
    isRenameModalOpen.value = true;
  },
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
    emit('close-drawer');
  },
  cancelProxy: () => proxyStore.cancelProxyGeneration(selectedPath.value!),
  deleteProxy: () => proxyStore.deleteProxy(selectedPath.value!),
  createOtioVersion: () => {
    uiStore.pendingOtioCreateVersion = props.selectedFsEntry;
  },
  extractAudio: () =>
    extractAudio(props.selectedFsEntry, {
      instanceId: props.instanceId,
      isExternal: isExternalContext.value,
    }),
  createSubgroup: () => {
    const entry = props.selectedFsEntry;
    if (!entry || entry.kind !== 'directory') return;
    (uiStore as { pendingBloggerDogCreateSubgroup?: unknown }).pendingBloggerDogCreateSubgroup =
      entry;
  },
  createContentItem: () => {
    const entry = props.selectedFsEntry;
    if (!entry || entry.kind !== 'directory') return;
    (uiStore as { pendingBloggerDogCreateItem?: unknown }).pendingBloggerDogCreateItem = entry;
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
  isMediaFullyUnsupported,
  experimentalFeatures: computed(() => workspaceStore.userSettings.experimentalFeatures),
});

const { isMobile: isMobileDevice } = useDevice();
const { isMobileLayout } = useMobileLayout();
const isMobile = computed(() => isMobileDevice || isMobileLayout.value);

const {
  filteredDirectoryPrimaryActions,
  filteredFilePrimaryActions,
  filteredFileSecondaryActions,
  virtualAllPrimaryActions,
  virtualAllSecondaryActions,
  personalLibraryPrimaryActions,
  personalLibrarySecondaryActions,
  projectPrimaryActions,
  projectSecondaryActions,
  workspaceRootPrimaryActions,
  workspaceRootSecondaryActions,
} = useFilePropertiesActionGroups({
  directoryPrimaryActions,
  directorySecondaryActions,
  filePrimaryActions,
  fileSecondaryActions,
  isPersonalLibrary,
  isRemoteContent,
  isRemoteFileEntry,
  isExternalContext,
  isMobile,
  hasClipboardItems,
  selectedFsEntry: () => props.selectedFsEntry,
  onPaste,
  createSubfolder,
  createMarkdownInFolder,
  t,
});

const hasVisibleSecondaryActions = (actions: unknown) => {
  const list = Array.isArray(actions) ? actions : (actions as { value?: unknown[] })?.value;
  return Array.isArray(list) ? list.some((a) => !(a as { hidden?: boolean }).hidden) : false;
};
</script>

<template>
  <!-- IMPORTANT: NO LOADING INDICATORS ALLOWED HERE. ALL PROPERTIES MUST LOAD SILENTLY. -->
  <div class="w-full flex flex-col" :class="mobileTextMode ? 'flex-1 min-h-0 gap-0' : 'gap-4'">
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
          <span v-if="videoCodecLabel" class="opacity-60"> ({{ videoCodecLabel }}) </span>
        </li>
        <li v-if="isAudioCodecUnsupported">
          {{ t('videoEditor.fileManager.compatibility.audioCodecUnsupported') }}
          <span v-if="audioCodecLabel" class="opacity-60"> ({{ audioCodecLabel }}) </span>
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
      :vfs="effectiveVfs"
      :flexible="mobileTextMode && mediaType === 'text'"
    />

    <template v-if="!mobileTextMode || mediaType !== 'text'">
      <PropertySection
        v-if="
          isWorkspaceRootProperties &&
          (!isMobile || hasVisibleSecondaryActions(workspaceRootSecondaryActions))
        "
        key="actions-workspace-root"
        :title="t('videoEditor.fileManager.actions.title')"
      >
        <EntryActions
          :primary-actions="isMobile ? [] : workspaceRootPrimaryActions"
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
          (isVideoFile || mediaType === 'audio') &&
          !isMediaFullyUnsupported
        "
        :media-meta="liveMediaMeta"
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
        :deep-link="bloggerDogDeepLink"
      />

      <BloggerDogCollectionProperties
        v-if="!isWorkspaceRootProperties && isBloggerDogGroup && castedRemoteRecord"
        :collection="castedRemoteRecord as RemoteVfsDirectoryEntry"
        :config="remoteFilesConfig!"
        :deep-link="bloggerDogDeepLink"
      />

      <PropertySection
        v-if="
          !isWorkspaceRootProperties &&
          !hideActions &&
          fileInfo &&
          fileInfo.kind === 'directory' &&
          !isRemoteRoot &&
          !isVirtualAll &&
          !isPersonalLibrary &&
          !isProjectLibraries &&
          !isBloggerDogProject &&
          (!isMobile || hasVisibleSecondaryActions(directorySecondaryActions))
        "
        key="actions-directory"
        :title="t('videoEditor.fileManager.actions.title')"
      >
        <EntryActions
          :primary-actions="isMobile ? [] : filteredDirectoryPrimaryActions"
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
          !isBloggerDogProject &&
          (!isMobile || hasVisibleSecondaryActions(filteredFileSecondaryActions))
        "
        key="actions-file"
        :title="t('videoEditor.fileManager.actions.title')"
      >
        <EntryActions
          :primary-actions="isMobile ? [] : filteredFilePrimaryActions"
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
        <PropertySection :title="t('fastcat.bloggerDog.contentLibrary')">
          <PropertyRow :label="t('fastcat.bloggerDog.connection')">
            <div class="flex items-center gap-2 text-green-400">
              <span>{{ t('fastcat.bloggerDog.connected') }}</span>
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
        :title="t('fastcat.bloggerDog.allContent')"
      >
        <div class="text-xs text-ui-text-muted italic px-2 py-1 mb-2">
          {{
            t(
              'fastcat.bloggerDog.virtualAllDesc',
              'Виртуальный плосский список всех элементов контента',
            )
          }}
        </div>
        <PropertyRow v-if="bloggerDogDeepLink" :label="t('common.path')">
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
        v-if="
          !isWorkspaceRootProperties &&
          !hideActions &&
          isVirtualAll &&
          (!isMobile || hasVisibleSecondaryActions(virtualAllSecondaryActions))
        "
        :title="t('videoEditor.fileManager.actions.title')"
      >
        <EntryActions
          :primary-actions="isMobile ? [] : virtualAllPrimaryActions"
          :secondary-actions="virtualAllSecondaryActions"
        />
      </PropertySection>

      <PropertySection
        v-if="!isWorkspaceRootProperties && isPersonalLibrary"
        :title="t('fastcat.bloggerDog.personalLibrary')"
      >
        <div class="text-xs text-ui-text-muted italic px-2 py-1 mb-2">
          {{ t('fastcat.bloggerDog.personalLibraryDesc') }}
        </div>
        <PropertyRow v-if="bloggerDogDeepLink" :label="t('common.path')">
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
        v-if="
          !isWorkspaceRootProperties &&
          !hideActions &&
          isPersonalLibrary &&
          (!isMobile || hasVisibleSecondaryActions(personalLibrarySecondaryActions))
        "
        :title="t('videoEditor.fileManager.actions.title')"
      >
        <EntryActions
          :primary-actions="isMobile ? [] : personalLibraryPrimaryActions"
          :secondary-actions="personalLibrarySecondaryActions"
        />
      </PropertySection>

      <PropertySection
        v-if="!isWorkspaceRootProperties && isProjectLibraries"
        :title="t('fastcat.bloggerDog.projectLibraries')"
      >
        <div class="text-xs text-ui-text-muted italic px-2 py-1 mb-2">
          {{ t('fastcat.bloggerDog.projectLibrariesDesc') }}
        </div>
        <PropertyRow v-if="bloggerDogDeepLink" :label="t('common.path')">
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
        <PropertyRow v-if="selectedPath" :label="t('common.path')">
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
        v-if="
          !isWorkspaceRootProperties &&
          !hideActions &&
          isBloggerDogProject &&
          (!isMobile || hasVisibleSecondaryActions(projectSecondaryActions))
        "
        :title="t('videoEditor.fileManager.actions.title')"
      >
        <EntryActions
          :primary-actions="isMobile ? [] : projectPrimaryActions"
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
        :file-info="(fileInfo || selectedFsEntry) as any"
        :selected-path="selectedPath"
        :is-hidden="isHidden"
        :format-bytes="formatBytes"
        :media-count="remoteMediaCount"
        :instance-id="props.instanceId"
        :is-external="isExternalContext"
        :hide-header="
          (props.selectedFsEntry as { mimeType?: string })?.mimeType === 'application/octet-stream'
        "
      >
        <template v-if="mediaType === 'text' && lineCount !== null">
          <PropertyRow :label="t('fastcat.file.lineCount')" :value="lineCount" />
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
          !isBloggerDogContentItem &&
          !isBloggerDogGroup
        "
        :title="generalInfoTitle"
        :file-info="(fileInfo || selectedFsEntry) as any"
        :selected-path="selectedPath"
        :path-link="bloggerDogDeepLink"
        :is-hidden="isHidden"
        :format-bytes="formatBytes"
        :media-count="remoteMediaCount"
        :instance-id="props.instanceId"
        :is-external="isExternalContext"
      >
        <template v-if="selectedFsEntry?.source === 'remote' && remoteItemsCount !== undefined">
          <PropertyRow :label="t('fastcat.file.itemsCount')" :value="remoteItemsCount" />
        </template>
      </FileGeneralInfoSection>

      <!-- General info for files moved to top -->

      <ExpandableYamlSection
        v-if="
          !isWorkspaceRootProperties &&
          (fileInfo?.kind === 'file' || selectedFsEntry?.kind === 'file') &&
          (isVideoFile || isAudioFile) &&
          !isMediaFullyUnsupported &&
          metadataYaml &&
          !['{}', '[]', 'null', ''].includes(metadataYaml.trim())
        "
        :title="t('common.meta')"
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

      <UiRenameModal
        v-if="selectedFsEntry"
        :open="isRenameModalOpen"
        :current-name="selectedFsEntry.name"
        select-without-extension
        @update:open="isRenameModalOpen = $event"
        @rename="handleRenameConfirm"
      />
    </template>
  </div>
</template>
