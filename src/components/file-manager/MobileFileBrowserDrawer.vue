<script setup lang="ts">
import { computed } from 'vue';
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

const props = defineProps<{
  isOpen: boolean;
  isSelectionMode: boolean;
  isTranscribable?: boolean;
  onAction?: (action: FileAction, entry: FsEntry | FsEntry[]) => Promise<void>;
}>();

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

const selectedEntity = computed(() => selectionStore.selectedEntity);

const isOpenLocal = computed({
  get: () => props.isOpen,
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

const canAddToTimeline = computed(() => {
  if (props.isSelectionMode) return false;
  if (!selectedEntity.value || selectedEntity.value.kind !== 'file') return false;
  return isOpenableProjectFileName(selectedEntity.value.name);
});

const canConvert = computed(() => {
  if (!selectedFsEntry.value || selectedFsEntry.value.entry.kind !== 'file') return false;
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
      label: t('videoEditor.fileManager.actions.convertFile', 'Convert'),
      icon: 'lucide:replace',
      onClick: () => {
        conversionStore.openConversionModal(entry);
      },
    });
  }

  // Transcribe (Video or Audio)
  if (isVideo.value || isAudio.value) {
    actions.push({
      id: 'transcribe',
      label: t('videoEditor.fileManager.actions.transcribe', 'Transcribe'),
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
        label: t('videoEditor.fileManager.actions.cancelProxyGeneration', 'Cancel Proxy'),
        icon: 'i-heroicons-no-symbol',
        onClick: () => proxyStore.cancelProxyGeneration(path),
      });
    } else if (hasProxy) {
      actions.push({
        id: 'deleteProxy',
        label: t('videoEditor.fileManager.actions.deleteProxy', 'Delete Proxy'),
        icon: 'i-heroicons-trash',
        onClick: () => proxyStore.deleteProxy(path),
      });
    } else {
      actions.push({
        id: 'createProxy',
        label: t('videoEditor.fileManager.actions.createProxy', 'Create Proxy'),
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
      label: t('videoEditor.fileManager.actions.extractAudio', 'Extract audio'),
      icon: 'i-heroicons-musical-note',
      onClick: () => extractAudio(entry),
    });
  }

  return actions;
});

function handleAction(actionId: FileAction) {
  if (props.onAction) {
    const list = selectedEntriesList.value;
    if (actionId === 'rename' && list.length === 1 && list[0]) {
      void props.onAction(actionId, list[0]);
    } else if (list.length > 0) {
      void props.onAction(actionId, list);
    }
  }
}
</script>

<template>
  <UiMobileDrawer
    v-model:open="isOpenLocal"
    :show-close="false"
    :is-full-height="isTextDocument"
  >
    <template #toolbar>
      <div class="flex flex-col bg-ui-bg/50">
        <MobileDrawerToolbar v-if="props.onAction" class="border-b border-ui-border">
          <MobileDrawerToolbarButton
            icon="i-heroicons-trash"
            :label="$t('common.delete', 'Delete')"
            @click="handleAction('delete')"
          />
          <MobileDrawerToolbarButton
            v-if="selectedEntriesList.length === 1"
            icon="i-heroicons-pencil-square"
            :label="$t('common.rename', 'Rename')"
            @click="handleAction('rename')"
          />
          <MobileDrawerToolbarButton
            icon="i-heroicons-document-duplicate"
            :label="$t('common.copy', 'Copy')"
            @click="handleAction('copy')"
          />
          <MobileDrawerToolbarButton
            icon="i-heroicons-scissors"
            :label="$t('common.cut', 'Cut')"
            @click="handleAction('cut')"
          />
          <MobileDrawerToolbarButton
            v-if="canAddToTimeline"
            success
            icon="lucide:plus"
            :label="$t('common.toTimeline', 'To timeline')"
            @click="emit('add-to-timeline')"
          />
        </MobileDrawerToolbar>

        <div v-if="topActions.length > 0 && !isTextDocument" class="py-2 px-4 border-b border-ui-border shrink-0">
          <PropertyActionList
            :actions="topActions"
            vertical
            variant="ghost"
            size="md"
          />
        </div>
      </div>
    </template>

    <div class="flex flex-col h-full relative overflow-hidden">
      <!-- Scrollable content -->
      <div
        class="flex-1"
        data-vaul-no-drag
        :class="isTextDocument ? 'overflow-hidden p-0 pb-16' : 'overflow-y-auto px-4 pb-24'"
      >
        <div v-if="selectedFsEntry" class="h-full" :class="!isTextDocument && 'py-2'">
          <FileProperties
            :selected-fs-entry="selectedFsEntry.entry"
            preview-mode="original"
            :has-proxy="false"
            :mobile-text-mode="isTextDocument"
            :hide-actions="isImage || isVideo || isAudio || isTextDocument"
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
