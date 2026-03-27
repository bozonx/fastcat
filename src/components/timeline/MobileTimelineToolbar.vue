<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';

const timelineStore = useTimelineStore();

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
  <div
    class="flex items-center justify-between gap-2 overflow-x-auto border-b border-ui-border bg-ui-bg-elevated px-2 py-2 shadow-sm no-scrollbar"
  >
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1">
        <UiActionButton
          icon="lucide:undo"
          color="neutral"
          size="sm"
          title="Undo"
          @click="handleUndo"
        />
        <UiActionButton
          icon="lucide:redo"
          color="neutral"
          size="sm"
          title="Redo"
          @click="handleRedo"
        />
      </div>

      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1">
        <UiActionButton
          icon="i-lucide-scissors"
          color="neutral"
          size="sm"
          title="Split"
          @click="handleSplit"
        />
        <UiActionButton
          icon="lucide:trash-2"
          color="neutral"
          size="sm"
          :disabled="!hasSelection"
          title="Delete selection"
          @click="handleDelete"
        />
      </div>
    </div>

    <div class="flex items-center gap-2">
      <span class="text-2xs font-medium tabular-nums text-ui-text-muted">{{ timelineZoom }}%</span>
      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1">
        <UiActionButton
          icon="lucide:zoom-out"
          color="neutral"
          size="sm"
          title="Zoom out"
          @click="handleZoomOut"
        />
        <UiActionButton
          icon="lucide:zoom-in"
          color="neutral"
          size="sm"
          title="Zoom in"
          @click="handleZoomIn"
        />
      </div>
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
