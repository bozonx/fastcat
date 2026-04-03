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

const topActions = computed(() => {
  const actions = [];
  if (canAddToTimeline.value) {
    actions.push({
      id: 'add-to-timeline',
      label: t('common.addToTimeline', 'Add to timeline'),
      icon: 'lucide:plus',
      onClick: () => emit('add-to-timeline'),
    });
  }
  if (canConvert.value) {
    actions.push({
      id: 'convert',
      label: t('videoEditor.fileManager.actions.convertFile', 'Convert'),
      icon: 'lucide:replace',
      onClick: () => {
        if (selectedFsEntry.value) {
          conversionStore.openConversionModal(selectedFsEntry.value.entry);
        }
      },
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
      <MobileDrawerToolbar v-if="props.onAction" class="border-b border-ui-border bg-ui-bg/50">
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
          v-if="props.isTranscribable"
          icon="i-heroicons-language"
          :label="$t('videoEditor.fileManager.actions.transcribe', 'Transcribe')"
          @click="handleAction('transcribe')"
        />
      </MobileDrawerToolbar>
    </template>

    <div class="flex flex-col h-full relative overflow-hidden">

      <div v-if="topActions.length > 0 && !isTextDocument" class="py-2 px-4 border-b border-ui-border shrink-0">
        <PropertyActionList
          :actions="topActions"
          vertical
          variant="ghost"
          size="md"
        />
      </div>

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
            :hide-actions="isImage"
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
