<script setup lang="ts">
import { computed } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import { useWindowSize } from '@vueuse/core';
import FileProperties from '~/components/properties/FileProperties.vue';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import { isOpenableProjectFileName } from '~/utils/media-types';
import type { FileAction } from '~/composables/fileManager/useFileManagerActions';

const props = defineProps<{
  isOpen: boolean;
  isSelectionMode: boolean;
  onAction?: (action: FileAction, entry: any) => Promise<void>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'add-to-timeline'): void;
}>();

const selectionStore = useSelectionStore();
const selectedEntity = computed(() => selectionStore.selectedEntity);

const { width, height } = useWindowSize();
const isLandscape = computed(() => width.value > height.value);

// Sync prop with UDrawer's v-model:open
const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) {
      emit('close');
    }
  },
});

const isFileOrDirectory = computed(() => {
  return (
    selectedEntity.value?.source === 'fileManager' &&
    (selectedEntity.value.kind === 'file' || selectedEntity.value.kind === 'directory')
  );
});

const isMultiple = computed(() => {
  return selectedEntity.value?.source === 'fileManager' && selectedEntity.value.kind === 'multiple';
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
    if (actionId === 'rename' && list.length === 1) {
      void props.onAction(actionId, list[0]);
    } else {
      void props.onAction(actionId, list);
    }
  }
}
</script>

<template>
  <UDrawer
    v-model:open="isOpenLocal"
    :direction="isLandscape ? 'right' : 'bottom'"
    :title="
      isMultiple
        ? $t('common.selectedItems', 'Selected items')
        : $t('common.properties', 'Properties')
    "
    :description="
      isMultiple ? `${selectedEntriesList.length} ${$t('common.items', 'items')}` : undefined
    "
  >
    <template #content>
      <div
        class="flex flex-col h-full ml-auto"
        :class="isLandscape ? 'max-h-dvh w-[50vw]' : 'max-h-[85dvh] w-full'"
      >
        <!-- Action Toolbar -->
        <div
          v-if="props.onAction"
          class="px-2 pt-2 pb-3 flex gap-2 justify-around border-b border-slate-800 shrink-0 bg-slate-900/50"
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
          <UButton
            icon="lucide:copy"
            variant="ghost"
            color="neutral"
            @click="handleAction('copy')"
          />
          <UButton
            icon="lucide:scissors"
            variant="ghost"
            color="neutral"
            @click="handleAction('cut')"
          />
        </div>

        <!-- Scrollable content -->
        <div class="flex-1 overflow-y-auto px-4 pb-24 custom-scrollbar">
          <div v-if="isFileOrDirectory" class="py-2">
            <FileProperties
              :selected-fs-entry="(selectedEntity as any).entry"
              preview-mode="original"
              :has-proxy="false"
            />
          </div>
          <div v-else-if="isMultiple" class="py-2">
            <MultiFileProperties :entries="(selectedEntity as any).entries" />
          </div>
        </div>

        <!-- Add to Timeline Button -->
        <div
          v-if="canAddToTimeline"
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
    </template>
  </UDrawer>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 10px;
}
</style>
