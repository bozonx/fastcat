<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useFocusStore } from '~/stores/focus.store';
import type { TimelineTrack } from '~/timeline/types';
import { useI18n } from 'vue-i18n';
import { useToast } from '#imports';
import {
  useTimelineInteraction,
  timeUsToPx,
  pxToTimeUs,
  zoomToPxPerSecond,
} from '~/composables/timeline/useTimelineInteraction';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import { useLocalStorage } from '@vueuse/core';
import TimelineTabs from '~/components/timeline/TimelineTabs.vue';
import TimelineToolbar from '~/components/timeline/TimelineToolbar.vue';
import TimelineTrackLabels from '~/components/timeline/TimelineTrackLabels.vue';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';

const { t } = useI18n();
const toast = useToast();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();
const { draggedFile } = useDraggedFile();

const timelineSplitSizes = useLocalStorage<number[]>('gran-editor-timeline-split-v4', [10, 90]);

function onTimelineSplitResize(event: { panes: { size: number }[] }) {
  if (Array.isArray(event?.panes)) {
    timelineSplitSizes.value = event.panes.map(p => p.size);
  }
}

const trackHeights = useLocalStorage<Record<string, number>>('gran-editor-track-heights-v1', {});

function updateTrackHeight(trackId: string, height: number) {
  trackHeights.value[trackId] = height;
}

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const scrollEl = ref<HTMLElement | null>(null);

const dragPreview = ref<{
  trackId: string;
  startUs: number;
  label: string;
  durationUs: number;
  kind: 'timeline-clip' | 'file';
} | null>(null);

const {
  isDraggingPlayhead,
  movePreview,
  onTimeRulerMouseDown,
  startPlayheadDrag,
  selectItem,
  startMoveItem,
  startTrimItem,
} = useTimelineInteraction(scrollEl, tracks);

const pxPerSecond = computed(() => zoomToPxPerSecond(timelineStore.timelineZoom));

function clearDragPreview() {
  dragPreview.value = null;
}

function getDropStartUs(e: DragEvent): number | null {
  const scrollerRect = scrollEl.value?.getBoundingClientRect();
  const scrollX = scrollEl.value?.scrollLeft ?? 0;
  if (!scrollerRect) return null;
  const x = e.clientX - scrollerRect.left + scrollX;
  return pxToTimeUs(x, timelineStore.timelineZoom);
}

function onTrackDragOver(e: DragEvent, trackId: string) {
  const startUs = getDropStartUs(e);
  if (startUs === null) return;

  const file = draggedFile.value;
  if (!file) {
    clearDragPreview();
    return;
  }

  let durationUs = 2_000_000;
  if (file.kind !== 'timeline') {
    const metadata = mediaStore.mediaMetadata[file.path];
    if (metadata) {
      const hasVideo = Boolean(metadata.video);
      const hasAudio = Boolean(metadata.audio);
      const isImageLike = !hasVideo && !hasAudio;
      if (isImageLike) {
        durationUs = 5_000_000;
      } else {
        const durationS = Number(metadata.duration);
        if (Number.isFinite(durationS) && durationS > 0) {
          durationUs = Math.floor(durationS * 1_000_000);
        }
      }
    }
  }

  dragPreview.value = {
    trackId,
    startUs,
    label: file.name,
    durationUs,
    kind: file.kind === 'timeline' ? 'timeline-clip' : 'file',
  };
}

function onTrackDragLeave() {
  clearDragPreview();
}

async function onClipAction(payload: {
  action: 'extractAudio' | 'returnAudio' | 'freezeFrame' | 'resetFreezeFrame';
  trackId: string;
  itemId: string;
  videoItemId?: string;
}) {
  try {
    if (payload.action === 'extractAudio') {
      await timelineStore.extractAudioToTrack({
        videoTrackId: payload.trackId,
        videoItemId: payload.itemId,
      });
    } else if (payload.action === 'freezeFrame') {
      timelineStore.setClipFreezeFrameFromPlayhead({
        trackId: payload.trackId,
        itemId: payload.itemId,
      });
    } else if (payload.action === 'resetFreezeFrame') {
      timelineStore.resetClipFreezeFrame({
        trackId: payload.trackId,
        itemId: payload.itemId,
      });
    } else {
      timelineStore.returnAudioToVideo({ videoItemId: payload.videoItemId ?? payload.itemId });
    }
    await timelineStore.requestTimelineSave({ immediate: true });
  } catch (err: any) {
    toast.add({
      title: t('common.error', 'Error'),
      description: String(err?.message ?? err ?? ''),
      icon: 'i-heroicons-exclamation-triangle',
      color: 'error',
    });
  }
}

async function onDrop(e: DragEvent, trackId: string) {
  clearDragPreview();
  const startUs = getDropStartUs(e);
  const raw = e.dataTransfer?.getData('application/json');
  if (!raw) return;

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const kind = typeof parsed?.kind === 'string' ? parsed.kind : undefined;
  if (kind && kind !== 'file' && kind !== 'timeline') return;

  const name = typeof parsed?.name === 'string' ? parsed.name : undefined;
  const path = typeof parsed?.path === 'string' ? parsed.path : undefined;
  if (!name || !path) return;

  if (kind === 'timeline') {
    await timelineStore.addTimelineClipToTimelineFromPath({
      trackId,
      name,
      path,
      startUs: startUs ?? undefined,
    });
  } else {
    await timelineStore.addClipToTimelineFromPath({
      trackId,
      name,
      path,
      startUs: startUs ?? undefined,
    });
  }

  toast.add({
    title: t('granVideoEditor.timeline.clipAdded', 'Clip Added'),
    description: `${name} added to track`,
    icon: 'i-heroicons-check-circle',
    color: 'success',
  });
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg border-t border-ui-border"
    :class="{ 'ring-2 ring-inset ring-primary-500/60': focusStore.isPanelFocused('timeline') }"
    @pointerdown="focusStore.setMainFocus('timeline')"
  >
    <!-- Toolbar -->
    <TimelineToolbar />

    <ClientOnly>
      <Splitpanes class="flex flex-1 min-h-0 overflow-hidden editor-splitpanes" @resized="onTimelineSplitResize">
        <Pane :size="timelineSplitSizes[0]" min-size="5" max-size="50">
          <TimelineTrackLabels
            :tracks="tracks"
            :track-heights="trackHeights"
            class="h-full border-r border-ui-border"
            @update:track-height="updateTrackHeight"
          />
        </Pane>
        <Pane :size="timelineSplitSizes[1]" min-size="50">
          <div ref="scrollEl" class="w-full h-full overflow-x-auto overflow-y-hidden relative">
            <div
              class="h-7 border-b border-ui-border bg-ui-bg-elevated sticky top-0 flex items-end px-2 gap-16 text-xs text-ui-text-muted font-mono select-none cursor-pointer"
              @mousedown="onTimeRulerMouseDown"
            >
              <span
                v-for="n in 10"
                :key="n"
                :style="{ marginLeft: n === 1 ? '0px' : `${Math.max(0, pxPerSecond * 10 - 64)}px` }"
              >
                {{ formatTime((n - 1) * 10) }}
              </span>
            </div>

            <!-- Tracks -->
            <TimelineTracks
              :tracks="tracks"
              :track-heights="trackHeights"
              :drag-preview="dragPreview"
              :move-preview="movePreview"
              @drop="onDrop"
              @dragover="onTrackDragOver"
              @dragleave="onTrackDragLeave"
              @start-move-item="startMoveItem"
              @select-item="selectItem"
              @start-trim-item="startTrimItem"
              @clip-action="onClipAction"
            />

            <!-- Playhead -->
            <div
              class="absolute top-0 bottom-0 w-px bg-primary-500 cursor-ew-resize pointer-events-none"
              :style="{
                left: `${timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom)}px`,
              }"
            >
              <div
                class="w-2.5 h-2.5 bg-primary-500 rounded-full -translate-x-1/2 mt-0.5 pointer-events-auto"
                @mousedown="startPlayheadDrag"
              />
            </div>
          </div>
        </Pane>
      </Splitpanes>
    </ClientOnly>

    <!-- Tabs -->
    <TimelineTabs />
  </div>
</template>
