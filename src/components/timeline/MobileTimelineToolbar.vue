<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import MobileClipActionsDrawer from './MobileClipActionsDrawer.vue';
import MobileTrackManagerDrawer from './MobileTrackManagerDrawer.vue';
import TimelineSpeedModal from './TimelineSpeedModal.vue';

const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();

const { selectedItemIds, timelineZoom } = storeToRefs(timelineStore);

const hasSelection = computed(() => selectedItemIds.value.length > 0);

const isClipActionsDrawerOpen = ref(false);
const isTrackManagerDrawerOpen = ref(false);

function handleSplit() {
  if (hasSelection.value) {
    timelineStore.splitClipsAtPlayhead();
  } else {
    timelineStore.splitAllClipsAtPlayhead();
  }
}

function handleDelete() {
  timelineStore.deleteFirstSelectedItem();
  isClipActionsDrawerOpen.value = false;
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

const speedModal = ref<{ open: boolean; trackId: string; itemId: string; speed: number } | null>(null);

function handleOpenSpeedModal(payload: { trackId: string; itemId: string; speed: number }) {
  speedModal.value = {
    open: true,
    trackId: payload.trackId,
    itemId: payload.itemId,
    speed: payload.speed,
  };
}

async function saveSpeedModal() {
  if (!speedModal.value) return;
  const { trackId, itemId, speed } = speedModal.value;
  if (Math.abs(speed) < 0.1) return;
  timelineStore.updateClipProperties(trackId, itemId, { speed });
  speedModal.value.open = false;
  await timelineStore.requestTimelineSave({ immediate: true });
}

const speedModalTargetHasAudio = computed(() => {
  if (!speedModal.value) return false;
  const track = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined)?.find((t) => t.id === speedModal.value!.trackId);
  const clip = track?.items.find(
    (it): it is TimelineClipItem => it.id === speedModal.value!.itemId && it.kind === 'clip',
  );
  if (!clip || (track?.kind === 'video' && clip.audioFromVideoDisabled)) return false;
  if (track?.kind === 'audio') return true;
  return Boolean(clip.source?.path && mediaStore.mediaMetadata[clip.source.path]?.audio);
});
</script>

<template>
  <div
    class="flex items-center justify-between gap-2 border-b border-ui-border bg-ui-bg-elevated px-2 py-2 shadow-sm"
  >
    <div class="flex items-center gap-2 overflow-x-auto no-scrollbar">
      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1 shrink-0">
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

      <div class="flex items-center gap-1 rounded-xl bg-ui-bg px-1 py-1 shrink-0">
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
        <UiActionButton
          icon="lucide:sliders-horizontal"
          color="primary"
          size="sm"
          :disabled="!hasSelection"
          title="Clip Actions"
          @click="isClipActionsDrawerOpen = true"
        />
      </div>
    </div>

    <div class="flex items-center gap-2 shrink-0 border-l border-ui-border pl-2 ml-1">
      <UiActionButton
        icon="lucide:layers"
        color="neutral"
        size="sm"
        title="Manage Tracks"
        @click="isTrackManagerDrawerOpen = true"
      />
    </div>
  </div>

  <MobileClipActionsDrawer
    :is-open="isClipActionsDrawerOpen"
    @close="isClipActionsDrawerOpen = false"
    @open-speed-modal="handleOpenSpeedModal"
  />

  <MobileTrackManagerDrawer
    :is-open="isTrackManagerDrawerOpen"
    @close="isTrackManagerDrawerOpen = false"
  />

  <TimelineSpeedModal
    v-if="speedModal"
    v-model:open="speedModal.open"
    v-model:speed="speedModal.speed"
    :has-audio="speedModalTargetHasAudio"
    @save="saveSpeedModal"
  />
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
