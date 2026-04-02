<script setup lang="ts">
import { computed } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import FileProperties from '~/components/properties/FileProperties.vue';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import { isOpenableProjectFileName, getMediaTypeFromFilename } from '~/utils/media-types';
import type { FileAction } from '~/composables/file-manager/useFileManagerActions';
import type { SelectedFsEntry, SelectedFsEntries } from '~/stores/selection.store';
import type { FsEntry } from '~/types/fs';

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

const selectionStore = useSelectionStore();
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
    :title="
      isMultiple
        ? $t('common.selectedItems', 'Selected items')
        : $t('common.properties', 'Properties')
    "
    :description="
      isMultiple ? `${selectedEntriesList.length} ${$t('common.items', 'items')}` : undefined
    "
    :is-full-height="isTextDocument"
  >
    <div class="flex flex-col h-full relative overflow-hidden">
      <!-- Action Toolbar -->
      <div
        v-if="props.onAction"
        class="px-2 pt-2 pb-3 flex gap-2 justify-around border-b border-ui-border shrink-0 bg-ui-bg/50"
      >
        <UButton
          icon="lucide:trash-2"
          variant="ghost"
          color="red"
          @click="handleAction('delete')"
        />
        <UButton
          v-if="selectedEntriesList.length === 1"
          icon="lucide:pen-line"
          variant="ghost"
          color="neutral"
          @click="handleAction('rename')"
        />
        <UButton icon="lucide:copy" variant="ghost" color="neutral" @click="handleAction('copy')" />
        <UButton
          icon="lucide:scissors"
          variant="ghost"
          color="neutral"
          @click="handleAction('cut')"
        />
        <UButton
          v-if="props.isTranscribable"
          icon="lucide:languages"
          variant="ghost"
          color="primary"
          @click="handleAction('transcribe')"
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
          />
        </div>
        <div v-else-if="selectedFsMultiple" class="py-2">
          <MultiFileProperties :entries="selectedFsMultiple.entries" />
        </div>
      </div>

      <!-- Add to Timeline Button -->
      <div
        v-if="canAddToTimeline && !isTextDocument"
        class="absolute bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-5 duration-300"
      >
        <UButton
          size="xl"
          variant="solid"
          icon="lucide:plus"
          class="rounded-2xl shadow-2xl px-6 py-4 font-bold active:scale-95 transition-all text-white border-none bg-ui-action hover:bg-ui-action-hover shadow-ui-action/20"
          @click="emit('add-to-timeline')"
        >
          {{ $t('common.addToTimeline', 'Add to timeline') }}
        </UButton>
      </div>
    </div>
  </UiMobileDrawer>
</template>

<style scoped>
/* No extra styles needed as they're now in UiMobileDrawer */
</style>
