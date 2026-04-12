<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import FileProperties from '~/components/properties/FileProperties.vue';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import { isOpenableProjectFileName, getMediaTypeFromFilename } from '~/utils/media-types';
import type { FileAction } from '~/composables/file-manager/useFileManagerActions';
import type { SelectedFsEntry, SelectedFsEntries } from '~/stores/selection.store';
import type { FsEntry } from '~/types/fs';
import MobileDrawerToolbar from '~/components/timeline/MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from '~/components/timeline/MobileDrawerToolbarButton.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import { useFileConversionStore } from '~/stores/file-conversion.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useProjectStore } from '~/stores/project.store';
import { useAudioExtraction } from '~/composables/file-manager/useAudioExtraction';
import { useComputerVfs } from '~/composables/file-manager/useComputerVfs';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { useMediaStore } from '~/stores/media.store';
import { useI18n } from 'vue-i18n';

import { useRuntimeConfig } from 'nuxt/app';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';

const props = defineProps<{
  isOpen: boolean;
  isSelectionMode: boolean;
  onAction?: (action: FileAction, entry: FsEntry | FsEntry[]) => Promise<void>;
}>();

const { isOpen, isSelectionMode, onAction } = toRefs(props);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'add-to-timeline'): void;
}>();

const { t } = useI18n();
const selectionStore = useSelectionStore();
const conversionStore = useFileConversionStore();
const proxyStore = useProxyStore();
const projectStore = useProjectStore();
const { extractAudio } = useAudioExtraction();
const { vfs: computerVfs } = useComputerVfs();
const runtimeConfig = useRuntimeConfig();
const workspaceStore = useWorkspaceStore();

const isBloggerdogConnected = computed(() => {
  const cfg = resolveExternalServiceConfig({
    service: 'files',
    integrations: workspaceStore.userSettings.integrations,
    bloggerDogApiUrl:
      typeof runtimeConfig.public.bloggerDogApiUrl === 'string'
        ? runtimeConfig.public.bloggerDogApiUrl
        : '',
  });
  return Boolean(cfg);
});

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

const isMultiple = computed(() => {
  return selectedEntity.value?.source === 'fileManager' && selectedEntity.value.kind === 'multiple';
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
  if (isBloggerDogProject.value) return false;
  return true;
});

const canDelete = computed(() => {
  if (selectedEntriesList.value.length === 0) return false;
  if (isBloggerDogProject.value) return false;
  return true;
});

const isFullyUnsupported = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  if (!entry || entry.kind !== 'file' || !entry.path) return false;
  const mediaStore = useMediaStore();
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
  if (isFullyUnsupported.value) return false;
  return isOpenableProjectFileName(selectedEntity.value.name);
});

const canConvert = computed(() => {
  if (!selectedFsEntry.value || selectedFsEntry.value.entry.kind !== 'file') return false;
  if (isFullyUnsupported.value) return false;
  const type = getMediaTypeFromFilename(selectedFsEntry.value.entry.name);
  return ['video', 'audio', 'image'].includes(type);
});

const isImage = computed(() => {
  if (!selectedFsEntry.value || selectedFsEntry.value.entry.kind !== 'file') return false;
  const type = getMediaTypeFromFilename(selectedFsEntry.value.entry.name);
  return type === 'image';
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

const topActions = computed(() => {
  const entry = selectedFsEntry.value?.entry;
  const path = selectedFsEntry.value?.path;
  if (!entry || !path) return [];

  const actions: any[] = [];

  // Convert
  if (canConvert.value) {
    actions.push({
      id: 'convert',
      label: t('videoEditor.fileManager.actions.convertFile'),
      icon: 'lucide:replace',
      onClick: () => {
        conversionStore.openConversionModal(entry, {
          isExternal: true,
          vfs: computerVfs.value,
        });
      },
    });
  }

  // Transcribe (Video or Audio)
  if (isVideo.value || isAudio.value) {
    actions.push({
      id: 'transcribe',
      label: t('videoEditor.fileManager.actions.transcribe'),
      icon: 'i-heroicons-language',
      onClick: () => handleAction('transcribe'),
    });
  }

  // Proxy (Video only)
  if (isVideo.value) {
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
        id: 'deleteProxy',
        label: t('videoEditor.fileManager.actions.deleteProxy'),
        icon: 'i-heroicons-trash',
        onClick: () => proxyStore.deleteProxy(path),
      });
    } else {
      actions.push({
        id: 'createProxy',
        label: t('videoEditor.fileManager.actions.createProxy'),
        icon: 'i-heroicons-video-camera',
        onClick: async () => {
          const handle = await projectStore.getFileHandleByPath(path);
          if (handle) {
            await proxyStore.generateProxy(handle, path);
          }
        },
      });
    }
  }

  // Extract Audio (Video only)
  if (isVideo.value) {
    actions.push({
      id: 'extract-audio',
      label: t('videoEditor.fileManager.actions.extractAudio'),
      icon: 'i-heroicons-musical-note',
      onClick: () => extractAudio(entry, { isExternal: true }),
    });
  }

  return actions;
});

function handleAction(actionId: FileAction) {
  if (onAction?.value) {
    const list = selectedEntriesList.value;
    if (actionId === 'rename' && list.length === 1 && list[0]) {
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
              icon="i-heroicons-document-duplicate"
              :label="$t('common.copy')"
              @click="handleAction('copy')"
            />
            <MobileDrawerToolbarButton
              icon="i-heroicons-scissors"
              :label="$t('common.cut')"
              @click="handleAction('cut')"
            />
            <MobileDrawerToolbarButton
              v-if="
                clipboardStore.hasFileManagerPayload && selectedFsEntry?.entry.kind === 'directory'
              "
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
            :has-proxy="false"
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
