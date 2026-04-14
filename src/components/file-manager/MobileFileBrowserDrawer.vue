<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import FileProperties from '~/components/properties/FileProperties.vue';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import { isOpenableProjectFileName, getMediaTypeFromFilename } from '~/utils/media-types';
import type { FileAction as FileManagerAction } from '~/composables/file-manager/useFileManagerActions';
import type { SelectedFsEntry, SelectedFsEntries } from '~/stores/selection.store';
import type { FsEntry } from '~/types/fs';
import MobileDrawerToolbar from '~/components/timeline/MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from '~/components/timeline/MobileDrawerToolbarButton.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import { useProxyStore } from '~/stores/proxy.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { useMediaStore } from '~/stores/media.store';
import { useI18n } from 'vue-i18n';
import { useFileManager } from '~/composables/file-manager/useFileManager';

import { useRuntimeConfig } from 'nuxt/app';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import { isGeneratingProxyInDirectory, folderHasVideos } from '~/utils/fs-entry-utils';
import { getBdPayload } from '~/types/bloggerdog';
import {
  canCopyBloggerDogEntry,
  canCutBloggerDogEntry,
  canPasteIntoBloggerDogEntry,
  isBloggerDogTextWrapper,
} from '~/utils/bloggerdog-file-manager';
import { WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';

type DrawerAction =
  | FileManagerAction
  | 'openAsPanelCut'
  | 'openAsPanelSound'
  | 'openAsProjectTab';

const props = defineProps<{
  isOpen: boolean;
  isSelectionMode: boolean;
  onAction?: (action: DrawerAction, entry: FsEntry | FsEntry[]) => Promise<void>;
}>();

const { isOpen, isSelectionMode, onAction } = toRefs(props);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'add-to-timeline'): void;
}>();

const { t } = useI18n();
const selectionStore = useSelectionStore();
const proxyStore = useProxyStore();
const { readDirectory } = useFileManager();
const runtimeConfig = useRuntimeConfig();
const workspaceStore = useWorkspaceStore();
const mediaStore = useMediaStore();

const sttConfig = computed(() =>
  resolveExternalServiceConfig({
    service: 'stt',
    integrations: workspaceStore.userSettings.integrations,
    bloggerDogApiUrl: '',
    fastcatAccountApiUrl:
      typeof runtimeConfig.public.fastcatAccountApiUrl === 'string'
        ? runtimeConfig.public.fastcatAccountApiUrl
        : '',
  }),
);

const clipboardStore = useAppClipboard();

const selectedEntity = computed(() => selectionStore.selectedEntity);

const isOpenLocal = computed({
  get: () => isOpen.value,
  set: (val) => {
    if (!val) {
      emit('close');
    }
  },
});

const selectedFsEntry = computed(() => {
  if (
    selectedEntity.value?.source === 'fileManager' &&
    (selectedEntity.value.kind === 'file' || selectedEntity.value.kind === 'directory')
  ) {
    return selectedEntity.value as SelectedFsEntry;
  }
  return null;
});

const isTextDocument = computed(() => {
  if (!selectedFsEntry.value || selectedFsEntry.value.entry.kind !== 'file') return false;
  const type = getMediaTypeFromFilename(selectedFsEntry.value.entry.name);
  return type === 'text' || type === 'timeline';
});

const selectedFsMultiple = computed(() => {
  if (selectedEntity.value?.source === 'fileManager' && selectedEntity.value.kind === 'multiple') {
    return selectedEntity.value as SelectedFsEntries;
  }
  return null;
});

const selectedEntriesList = computed(() => {
  if (!selectedEntity.value || selectedEntity.value.source !== 'fileManager') return [];
  if (selectedEntity.value.kind === 'multiple') return selectedEntity.value.entries;
  return [selectedEntity.value.entry];
});

const isBloggerDogProject = computed(() => {
  const list = selectedEntriesList.value;
  if (list.length !== 1) return false;
  const entry = list[0];
  if (entry?.source !== 'remote' || entry?.kind !== 'directory') return false;
  const path = entry.path || '';
  const parts = path.split('/').filter(Boolean);
  return parts.length === 2 && parts[0] === 'projects';
});

const canRename = computed(() => {
  if (selectedEntriesList.value.length !== 1) return false;
  return !isProjectRoot.value && !isCommonRoot.value && !isBdVirtual.value && !isBdProject.value && !isBdText.value;
});

const canDelete = computed(() => {
  if (selectedEntriesList.value.length === 0) return false;
  if (selectedEntriesList.value.length > 1) return true;
  return !isProjectRoot.value && !isCommonRoot.value && !isBdVirtual.value && !isBdProject.value && !isBdText.value;
});

const isOtioFile = computed(() => {
  return selectedFsEntry.value?.entry.name.toLowerCase().endsWith('.otio') ?? false;
});

const isBdVirtual = computed(() =>
  selectedFsEntry.value
    ? getBdPayload(selectedFsEntry.value.entry)?.type === 'virtual-folder'
    : false,
);
const isBdProject = computed(() =>
  selectedFsEntry.value ? getBdPayload(selectedFsEntry.value.entry)?.type === 'project' : false,
);
const isBdGroup = computed(() =>
  selectedFsEntry.value ? getBdPayload(selectedFsEntry.value.entry)?.type === 'collection' : false,
);
const isBdContentItem = computed(() =>
  selectedFsEntry.value ? getBdPayload(selectedFsEntry.value.entry)?.type === 'content-item' : false,
);
const isBdText = computed(() =>
  selectedFsEntry.value ? isBloggerDogTextWrapper(selectedFsEntry.value.entry) : false,
);
const isProjectRoot = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  return entry?.kind === 'directory' && (entry.path === '' || entry.path === '/');
});
const isCommonRoot = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  if (!entry || entry.kind !== 'directory') return false;
  return (
    entry.path === WORKSPACE_COMMON_PATH_PREFIX ||
    (entry.name.toLowerCase() === 'common' && (entry.path === 'common' || entry.path === ''))
  );
});
const isRemoteEntry = computed(() => selectedFsEntry.value?.entry.source === 'remote');

const isFullyUnsupported = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  if (!entry || entry.kind !== 'file' || !entry.path) return false;
  if (mediaStore.metadataLoadFailed[entry.path]) return true;
  const meta = mediaStore.mediaMetadata[entry.path];
  if (!meta) return false;
  if (meta.error) return true;
  const type = getMediaTypeFromFilename(entry.name);
  if (type === 'image' && meta.image?.canDisplay === false) return true;
  if (type === 'video' && meta.video?.canDecode === false) return true;
  if (type === 'audio' && meta.audio?.canDecode === false) return true;
  return false;
});

const canAddToTimeline = computed(() => {
  if (isSelectionMode.value) return false;
  if (!selectedEntity.value || selectedEntity.value.kind !== 'file') return false;
  if (selectedEntity.value.entry.source === 'remote') return false;
  if (isFullyUnsupported.value) return false;
  return isOpenableProjectFileName(selectedEntity.value.name);
});

const canConvert = computed(() => {
  if (!selectedFsEntry.value || selectedFsEntry.value.entry.kind !== 'file') return false;
  if (isFullyUnsupported.value) return false;
  const type = getMediaTypeFromFilename(selectedFsEntry.value.entry.name);
  return ['video', 'audio', 'image'].includes(type);
});

const isVideo = computed(() => {
  if (!selectedFsEntry.value || selectedFsEntry.value.entry.kind !== 'file') return false;
  const type = getMediaTypeFromFilename(selectedFsEntry.value.entry.name);
  return type === 'video';
});

const isAudio = computed(() => {
  if (!selectedFsEntry.value || selectedFsEntry.value.entry.kind !== 'file') return false;
  const type = getMediaTypeFromFilename(selectedFsEntry.value.entry.name);
  return type === 'audio';
});

const hasExistingProxy = computed(() => {
  if (!selectedFsEntry.value || !selectedFsEntry.value.path) return false;
  return proxyStore.existingProxies.has(selectedFsEntry.value.path);
});

const hasAudioTrack = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  if (!entry || entry.kind !== 'file' || !entry.path) return false;
  return Boolean(mediaStore.mediaMetadata[entry.path]?.audio);
});

const canOpenInPanels = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  if (!entry || entry.kind !== 'file' || entry.source === 'remote') return false;
  if (isFullyUnsupported.value) return false;
  return isOpenableProjectFileName(entry.name);
});

const canTranscribe = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  if (!entry || entry.kind !== 'file' || entry.source === 'remote') return false;
  const mediaType = getMediaTypeFromFilename(entry.name);
  const isMedia = mediaType === 'audio' || mediaType === 'video';
  if (!isMedia) return false;

  const isLocal = workspaceStore.userSettings.integrations.stt.provider === 'local';
  const isModelReady = isLocal ? workspaceStore.isSttModelDownloaded : Boolean(sttConfig.value);

  return isModelReady && Boolean(workspaceStore.workspaceHandle) && Boolean(entry.path);
});

const canCopySelection = computed(() =>
  selectedEntriesList.value.length > 0 &&
  selectedEntriesList.value.every((entry) => {
    const payload = getBdPayload(entry);
    return (
      !(entry.kind === 'directory' && (entry.path === '' || entry.path === '/')) &&
      !(
        entry.kind === 'directory' &&
        (entry.path === WORKSPACE_COMMON_PATH_PREFIX ||
          (entry.name.toLowerCase() === 'common' &&
            (entry.path === 'common' || entry.path === '')))
      ) &&
      payload?.type !== 'virtual-folder' &&
      payload?.type !== 'project' &&
      payload?.type !== 'collection' &&
      payload?.type !== 'content-item' &&
      canCopyBloggerDogEntry(entry)
    );
  }),
);

const canCutSelection = computed(() =>
  selectedEntriesList.value.length > 0 &&
  selectedEntriesList.value.every((entry) => {
    const payload = getBdPayload(entry);
    return (
      !(entry.kind === 'directory' && (entry.path === '' || entry.path === '/')) &&
      !(
        entry.kind === 'directory' &&
        (entry.path === WORKSPACE_COMMON_PATH_PREFIX ||
          (entry.name.toLowerCase() === 'common' &&
            (entry.path === 'common' || entry.path === '')))
      ) &&
      payload?.type !== 'virtual-folder' &&
      payload?.type !== 'project' &&
      payload?.type !== 'collection' &&
      payload?.type !== 'content-item' &&
      canCutBloggerDogEntry(entry)
    );
  }),
);

const canPasteIntoSelection = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  if (!entry || !clipboardStore.hasFileManagerPayload) return false;
  if (entry.source === 'remote') return canPasteIntoBloggerDogEntry(entry);

  return (
    (entry.kind === 'directory' && !isBdGroup.value && !isBdVirtual.value && !isBdProject.value) ||
    isBdContentItem.value
  );
});

const hasDirectVideoChildren = ref(false);

watch(
  selectedFsEntry,
  async (selected) => {
    if (!selected || selected.entry.kind !== 'directory') {
      hasDirectVideoChildren.value = false;
      return;
    }

    if (folderHasVideos(selected.entry)) {
      hasDirectVideoChildren.value = true;
      return;
    }

    const folderPath = selected.entry.path ?? '';
    const children = await readDirectory(folderPath).catch(() => []);
    hasDirectVideoChildren.value = children.some(
      (child) => child.kind === 'file' && getMediaTypeFromFilename(child.name) === 'video',
    );
  },
  { immediate: true },
);

const topActions = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  const path = selectedFsEntry.value?.path;
  if (!entry) return [];

  const actions: any[] = [];

  // Convert
  if (canConvert.value) {
    actions.push({
      id: 'convert',
      label: t('videoEditor.fileManager.actions.convertFile'),
      icon: 'lucide:replace',
      onClick: () => handleAction('convertFile'),
    });
  }

  // Transcribe (Video or Audio)
  if (isVideo.value || isAudio.value) {
    actions.push({
      id: 'transcribe',
      label: t('videoEditor.fileManager.actions.transcribe'),
      icon: 'i-heroicons-language',
      disabled: !canTranscribe.value,
      onClick: () => handleAction('transcribe'),
    });
  }

  // Proxy (Video only)
  if (isVideo.value && path) {
    const isGenerating = proxyStore.generatingProxies.has(path);
    const hasProxy = proxyStore.existingProxies.has(path);

    if (isGenerating) {
      actions.push({
        id: 'cancelProxy',
        label: t('videoEditor.fileManager.actions.cancelProxyGeneration'),
        icon: 'i-heroicons-no-symbol',
        onClick: () => proxyStore.cancelProxyGeneration(path),
      });
    } else if (hasProxy) {
      actions.push({
        id: 'regenerateProxy',
        label: t('videoEditor.fileManager.actions.regenerateProxy'),
        icon: 'i-heroicons-arrow-path',
        onClick: () => handleAction('createProxy'),
      });
      actions.push({
        id: 'deleteProxy',
        label: t('videoEditor.fileManager.actions.deleteProxy'),
        icon: 'i-heroicons-trash',
        onClick: () => handleAction('deleteProxy'),
      });
    } else {
      actions.push({
        id: 'createProxy',
        label: t('videoEditor.fileManager.actions.createProxy'),
        icon: 'i-heroicons-video-camera',
        onClick: () => handleAction('createProxy'),
      });
    }
  }

  // Extract Audio (Video only)
  if (isVideo.value && hasAudioTrack.value) {
    actions.push({
      id: 'extract-audio',
      label: t('videoEditor.fileManager.actions.extractAudio'),
      icon: 'i-heroicons-musical-note',
      onClick: () => handleAction('extractAudio'),
    });
  }

  // Create OTIO Version
  if (isOtioFile.value) {
    actions.push({
      id: 'createOtioVersion',
      label: t('fastcat.timeline.createVersion'),
      icon: 'i-heroicons-document-duplicate',
      onClick: () => handleAction('createOtioVersion'),
    });
  }

  if (canOpenInPanels.value) {
    actions.push(
      {
        id: 'openAsPanelCut',
        label: t('videoEditor.fileManager.actions.openAsPanelCut'),
        icon: 'i-heroicons-window',
        onClick: () => handleAction('openAsPanelCut'),
      },
      {
        id: 'openAsPanelSound',
        label: t('videoEditor.fileManager.actions.openAsPanelSound'),
        icon: 'i-heroicons-window',
        onClick: () => handleAction('openAsPanelSound'),
      },
      {
        id: 'openAsProjectTab',
        label: t('videoEditor.fileManager.actions.openAsProjectTab'),
        icon: 'i-heroicons-squares-plus',
        onClick: () => handleAction('openAsProjectTab'),
      },
    );
  }

  // Directory actions
  if (entry.kind === 'directory') {
    if (!isRemoteEntry.value) {
      actions.push(
        {
          id: 'createFolder',
          label: t('videoEditor.fileManager.actions.createFolder'),
          icon: 'i-heroicons-folder-plus',
          onClick: () => handleAction('createFolder'),
        },
        {
          id: 'upload',
          label: t('videoEditor.fileManager.actions.uploadFiles'),
          icon: 'i-heroicons-arrow-up-tray',
          onClick: () => handleAction('upload'),
        },
        {
          id: 'createTimeline',
          label: t('videoEditor.fileManager.actions.createTimeline'),
          icon: 'i-heroicons-document-plus',
          onClick: () => handleAction('createTimeline'),
        },
        {
          id: 'createMarkdown',
          label: t('videoEditor.fileManager.actions.createMarkdown'),
          icon: 'i-heroicons-document-text',
          onClick: () => handleAction('createMarkdown'),
        },
      );
    } else if (!isBdContentItem.value) {
      if (!isBdVirtual.value) {
        actions.push(
          {
            id: 'createFolder',
            label: t('videoEditor.fileManager.actions.createFolder'),
            icon: 'i-heroicons-folder-plus',
            onClick: () => handleAction('createFolder'),
          },
          {
            id: 'createMarkdown',
            label: t('videoEditor.fileManager.actions.createMarkdown'),
            icon: 'i-heroicons-document-text',
            onClick: () => handleAction('createMarkdown'),
          },
        );
      }
    }

    // Proxy for folder
    if (hasDirectVideoChildren.value && !isRemoteEntry.value) {
      if (isGeneratingProxyInDirectory(entry, proxyStore.generatingProxies)) {
        actions.push({
          id: 'cancelProxyForFolder',
          label: t('videoEditor.fileManager.actions.cancelProxyGeneration'),
          icon: 'i-heroicons-x-circle',
          color: 'error',
          onClick: () => handleAction('cancelProxyForFolder'),
        });
      } else {
        actions.push({
          id: 'createProxyForFolder',
          label: t('videoEditor.fileManager.actions.createProxyForAll'),
          icon: 'i-heroicons-film',
          onClick: () => handleAction('createProxyForFolder'),
        });
      }
    }

    // BloggerDog specific creations
    const canCreateSubgroup =
      isBdProject.value || isBdGroup.value || (isBdVirtual.value && entry.remoteId === 'personal');
    const canCreateItem =
      isBdProject.value ||
      isBdGroup.value ||
      (isBdVirtual.value && (entry.remoteId === 'personal' || entry.remoteId === 'virtual-all'));

    if (canCreateSubgroup) {
      actions.push({
        id: 'createSubgroup',
        label: t('fastcat.bloggerDog.actions.createSubgroup'),
        icon: 'i-heroicons-folder-plus',
        onClick: () => handleAction('createSubgroup'),
      });
    }

    if (canCreateItem) {
      actions.push({
        id: 'createContentItem',
        label: t('fastcat.bloggerDog.actions.createItem'),
        icon: 'i-heroicons-document-plus',
        onClick: () => handleAction('createContentItem'),
      });
    }
  }

  return actions;
});

function handleAction(actionId: DrawerAction) {
  if (onAction?.value) {
    const list = selectedEntriesList.value;
    if (list.length === 1 && list[0]) {
      void onAction.value(actionId, list[0]);
    } else if (list.length > 0) {
      void onAction.value(actionId, list);
    }
  }
}
</script>

<template>
  <UiMobileDrawer v-model:open="isOpenLocal" :show-close="false" :ui="{ container: 'h-[85dvh]' }">
    <div class="flex flex-col h-full relative overflow-hidden">
      <!-- Scrollable content -->
      <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-24" data-vaul-no-drag>
        <div class="mb-4 pt-1">
          <MobileDrawerToolbar
            v-if="selectedEntriesList.length > 0"
            class="-mx-4 border-b border-ui-border mb-2"
          >
            <MobileDrawerToolbarButton
              v-if="canDelete"
              icon="i-heroicons-trash"
              :label="$t('common.delete')"
              @click="handleAction('delete')"
            />
            <MobileDrawerToolbarButton
              v-if="canRename"
              icon="i-heroicons-pencil-square"
              :label="$t('common.rename')"
              @click="handleAction('rename')"
            />
            <MobileDrawerToolbarButton
              v-if="canCopySelection"
              icon="i-heroicons-document-duplicate"
              :label="$t('common.copy')"
              @click="handleAction('copy')"
            />
            <MobileDrawerToolbarButton
              v-if="canCutSelection"
              icon="i-heroicons-scissors"
              :label="$t('common.cut')"
              @click="handleAction('cut')"
            />
            <MobileDrawerToolbarButton
              v-if="canPasteIntoSelection"
              icon="i-heroicons-clipboard"
              :label="$t('common.paste')"
              @click="handleAction('paste')"
            />
            <MobileDrawerToolbarButton
              v-if="canAddToTimeline"
              success
              icon="lucide:plus"
              :label="$t('common.toTimeline')"
              @click="emit('add-to-timeline')"
            />
          </MobileDrawerToolbar>

          <div
            v-if="topActions.length > 0"
            class="py-1 px-3 border border-ui-border rounded-xl bg-zinc-900/40"
          >
            <PropertyActionList :actions="topActions" vertical variant="ghost" size="md" />
          </div>
        </div>

        <div v-if="selectedFsEntry" class="h-full py-2">
          <FileProperties
            :selected-fs-entry="selectedFsEntry.entry"
            preview-mode="original"
            :has-proxy="hasExistingProxy"
            :mobile-text-mode="isTextDocument"
            :hide-actions="selectedFsEntry.entry.kind === 'file'"
          />
        </div>
        <div v-else-if="selectedFsMultiple" class="py-2">
          <MultiFileProperties :entries="selectedFsMultiple.entries" />
        </div>
      </div>
    </div>
  </UiMobileDrawer>
</template>

<style scoped>
/* No extra styles needed as they're now in UiMobileDrawer */
</style>
