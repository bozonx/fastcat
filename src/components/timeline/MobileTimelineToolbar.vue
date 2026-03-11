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
  <div class="flex items-center justify-between gap-2 overflow-x-auto border-b border-ui-border bg-ui-bg-elevated px-2 py-2 shadow-sm no-scrollbar">
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1">
        <UButton
          icon="lucide:undo"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Undo"
          @click="handleUndo"
        />
        <UButton
          icon="lucide:redo"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Redo"
          @click="handleRedo"
        />
      </div>

      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1">
        <UButton
          icon="i-lucide-scissors"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Split"
          @click="handleSplit"
        />
        <UButton
          icon="lucide:trash-2"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Delete selection"
          :disabled="!hasSelection"
          @click="handleDelete"
        />
      </div>
    </div>

    <div class="flex items-center gap-2">
      <span class="text-[11px] font-medium tabular-nums text-ui-text-muted">{{ timelineZoom }}%</span>
      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1">
        <UButton
          icon="lucide:zoom-out"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Zoom out"
          @click="handleZoomOut"
        />
        <UButton
          icon="lucide:zoom-in"
          variant="ghost"
          color="neutral"
          size="sm"
          aria-label="Zoom in"
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
