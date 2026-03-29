<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import FileProperties from '~/components/properties/FileProperties.vue';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import { useWindowSize, usePointerSwipe } from '@vueuse/core';
import type { FileAction } from '~/composables/fileManager/useFileManagerActions';

const props = defineProps<{
  isOpen: boolean;    // Single tap info flag
  isSelectionMode: boolean; // Multiple selection enabled
  onAction?: (action: FileAction, entry: any) => Promise<void>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const selectionStore = useSelectionStore();
const { width, height } = useWindowSize();

const isLandscape = computed(() => width.value > height.value);
const selectedEntity = computed(() => selectionStore.selectedEntity);

// State for expanding in selection mode
const isExpanded = ref(false);

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

watch(() => props.isOpen, (val) => {
  if (val) isExpanded.value = true;
});

watch(() => props.isSelectionMode, (val) => {
  if (val && !props.isOpen) {
    isExpanded.value = false;
  }
});

const showDrawer = computed(() => props.isOpen || (props.isSelectionMode && selectedEntriesList.value.length > 0));

function handleOverlayClick() {
  isExpanded.value = false;
  if (props.isOpen) emit('close');
}

// Swipe handling
const swipeTarget = ref<HTMLElement | null>(null);
const { distanceY } = usePointerSwipe(swipeTarget, {
  onSwipeEnd(e, direction) {
    if (direction === 'up' && distanceY.value < -20) {
      isExpanded.value = true;
    } else if (direction === 'down' && distanceY.value > 20) {
      isExpanded.value = false;
      if (props.isOpen) emit('close');
    }
  }
});

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
  if (!isExpanded.value && props.isOpen) {
    emit('close');
  }
}

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
  <div class="fixed inset-0 z-50 pointer-events-none" :class="{ 'pointer-events-auto': showDrawer }">
    <!-- Overlay -->
    <div
      class="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
      :class="[isExpanded ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none']"
      @click="handleOverlayClick"
    />

    <!-- Drawer Content -->
    <div
      class="absolute bg-slate-900 border-slate-800 shadow-2xl transition-all duration-300 flex flex-col pointer-events-auto"
      :class="[
        isLandscape
          ? 'top-0 right-0 h-full w-80 border-l rounded-l-3xl'
          : 'bottom-0 left-0 w-full border-t rounded-t-3xl overflow-hidden',
        showDrawer
          ? (isExpanded ? 'translate-x-0 translate-y-0 h-[80vh]' : 'translate-x-0 translate-y-0')
          : isLandscape
            ? 'translate-x-full'
            : 'translate-y-full',
      ]"
      :style="!isLandscape && !isExpanded ? { height: 'auto' } : {}"
    >
      <!-- Handle/Header -->
      <div 
        ref="swipeTarget" 
        class="flex flex-col items-center justify-center p-3 shrink-0 cursor-pointer select-none touch-none bg-slate-900"
        @click="toggleExpand"
      >
        <div v-if="!isLandscape" class="w-12 h-1.5 bg-slate-700 hover:bg-slate-600 transition-colors rounded-full mb-2" />
        <div v-else class="flex justify-between items-center w-full px-2 mb-2">
          <h3 class="font-bold text-lg">{{ $t('common.properties', 'Properties') }}</h3>
          <UButton icon="lucide:x" variant="ghost" color="neutral" @click="handleOverlayClick" />
        </div>
        <div v-if="!isExpanded && showDrawer && !isLandscape" class="text-xs text-slate-400 font-medium">
          {{ selectedEntriesList.length }} {{ $t('common.selectedItems', 'Selected') }}
        </div>
      </div>

      <!-- Action Toolbar -->
      <div v-if="showDrawer && props.onAction" class="px-2 pb-3 flex gap-2 justify-around border-b border-slate-800 shrink-0 bg-slate-900">
        <UButton icon="lucide:trash-2" variant="ghost" color="red" @click="handleAction('delete')" class="flex flex-col items-center p-2 rounded-xl" />
        <UButton v-if="selectedEntriesList.length === 1" icon="lucide:pen-line" variant="ghost" color="neutral" @click="handleAction('rename')" class="flex flex-col items-center p-2 rounded-xl" />
        <UButton icon="lucide:copy" variant="ghost" color="neutral" @click="handleAction('copy')" class="flex flex-col items-center p-2 rounded-xl" />
        <UButton icon="lucide:scissors" variant="ghost" color="neutral" @click="handleAction('cut')" class="flex flex-col items-center p-2 rounded-xl" />
      </div>

      <!-- Scrollable content -->
      <div v-show="isExpanded || isLandscape" class="flex-1 overflow-y-auto px-4 pb-10 bg-slate-900 custom-scrollbar">
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
    </div>
  </div>
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
