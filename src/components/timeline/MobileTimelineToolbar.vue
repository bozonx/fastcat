<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const uiStore = useUiStore();

const { selectedItemIds, timelineZoom } = storeToRefs(timelineStore);

const hasSelection = computed(() => selectedItemIds.value.length > 0);

function handleSplit() {
  if (hasSelection.value) {
    timelineStore.splitClipsAtPlayhead();
  } else {
    timelineStore.splitAllClipsAtPlayhead();
  }
}

function handleDelete() {
  timelineStore.deleteFirstSelectedItem();
}

function handleUndo() {
  timelineStore.undoTimeline();
}

function handleRedo() {
  timelineStore.redoTimeline();
}

function handleZoomIn() {
  timelineStore.setTimelineZoomExact(timelineZoom.value + 10);
}

function handleZoomOut() {
  timelineStore.setTimelineZoomExact(timelineZoom.value - 10);
}
</script>

<template>
  <div class="flex items-center justify-between px-2 py-1.5 bg-ui-bg-elevated border-b border-ui-border overflow-x-auto no-scrollbar gap-1 shadow-sm">
    <div class="flex items-center gap-1">
      <UTooltip :text="t('videoEditor.hotkeys.general.undo')">
        <UButton
          icon="i-heroicons-arrow-uturn-left"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="handleUndo"
        />
      </UTooltip>
      <UTooltip :text="t('videoEditor.hotkeys.general.redo')">
        <UButton
          icon="i-heroicons-arrow-uturn-right"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="handleRedo"
        />
      </UTooltip>
    </div>

    <div class="h-6 w-px bg-ui-border mx-1 shrink-0" />

    <div class="flex items-center gap-1">
      <UTooltip :text="t('videoEditor.hotkeys.timeline.splitAtPlayhead')">
        <UButton
          icon="i-lucide-scissors"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="handleSplit"
        />
      </UTooltip>
      <UTooltip :text="t('videoEditor.hotkeys.general.delete')">
        <UButton
          icon="i-heroicons-trash"
          variant="ghost"
          color="neutral"
          size="sm"
          :disabled="!hasSelection"
          @click="handleDelete"
        />
      </UTooltip>
    </div>

    <div class="h-6 w-px bg-ui-border mx-1 shrink-0" />

    <div class="flex items-center gap-1">
      <UTooltip :text="t('videoEditor.hotkeys.general.zoomOut')">
        <UButton
          icon="i-heroicons-minus"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="handleZoomOut"
        />
      </UTooltip>
      <UTooltip :text="t('videoEditor.hotkeys.general.zoomIn')">
        <UButton
          icon="i-heroicons-plus"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="handleZoomIn"
        />
      </UTooltip>
    </div>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
