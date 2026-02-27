<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useMediaStore } from '~/stores/media.store';
import { useFocusStore } from '~/stores/focus.store';
import type { TimelineTrack } from '~/timeline/types';
import { useI18n } from 'vue-i18n';
import { useToast } from '#imports';
import {
  useTimelineInteraction,
  computeAnchoredScrollLeft,
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
import TimelineRuler from '~/components/timeline/TimelineRuler.vue';

const { t } = useI18n();
const toast = useToast();
const timelineStore = useTimelineStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();
const { draggedFile } = useDraggedFile();

const timelineSplitSizes = useLocalStorage<number[]>('gran-editor-timeline-split-v4', [10, 90]);

function onTimelineSplitResize(event: { panes: { size: number }[] }) {
  if (Array.isArray(event?.panes)) {
    timelineSplitSizes.value = event.panes.map((p) => p.size);
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

const pendingZoomAnchor = ref<
  import('~/composables/timeline/useTimelineInteraction').TimelineZoomAnchor | null
>(null);

const dragPreview = ref<{
  trackId: string;
  startUs: number;
  label: string;
  durationUs: number;
  kind: 'timeline-clip' | 'file';
} | null>(null);

const {
  isDraggingPlayhead,
  draggingMode,
  draggingItemId,
  movePreview,
  onTimeRulerMouseDown,
  startPlayheadDrag,
  selectItem,
  startMoveItem,
  startTrimItem,
} = useTimelineInteraction(scrollEl, tracks);

const pxPerSecond = computed(() => zoomToPxPerSecond(timelineStore.timelineZoom));

function getViewportWidth(): number {
  return scrollEl.value?.clientWidth ?? 0;
}

function makePlayheadAnchor(params: {
  zoom: number;
}): import('~/composables/timeline/useTimelineInteraction').TimelineZoomAnchor {
  const viewportWidth = getViewportWidth();
  const prevScrollLeft = scrollEl.value?.scrollLeft ?? 0;
  const playheadPx = timeUsToPx(timelineStore.currentTime, params.zoom);
  const isVisible = playheadPx >= prevScrollLeft && playheadPx <= prevScrollLeft + viewportWidth;
  return {
    anchorTimeUs: timelineStore.currentTime,
    anchorViewportX: isVisible ? playheadPx - prevScrollLeft : viewportWidth / 2,
  };
}

function applyZoomWithAnchor(params: {
  nextZoom: number;
  anchor: import('~/composables/timeline/useTimelineInteraction').TimelineZoomAnchor;
}) {
  const el = scrollEl.value;
  if (!el) {
    timelineStore.setTimelineZoom(params.nextZoom);
    return;
  }

  const prevZoom = timelineStore.timelineZoom;
  const nextZoom = params.nextZoom;
  if (nextZoom === prevZoom) return;

  const prevScrollLeft = el.scrollLeft;
  const viewportWidth = el.clientWidth;

  pendingZoomAnchor.value = params.anchor;
  timelineStore.setTimelineZoom(nextZoom);

  requestAnimationFrame(() => {
    const anchor = pendingZoomAnchor.value;
    if (!anchor) return;
    pendingZoomAnchor.value = null;

    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom,
      nextZoom,
      prevScrollLeft,
      viewportWidth,
      anchor,
    });
    el.scrollLeft = nextScrollLeft;
  });
}

function onTimelineWheel(e: WheelEvent) {
  const el = scrollEl.value;
  if (!el) return;

  const isShift = e.shiftKey;
  const isSecondary =
    (e.deltaX !== 0 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) || (!e.deltaY && e.deltaX !== 0);

  const workspaceStore = useWorkspaceStore();
  const settings = workspaceStore.userSettings?.mouse?.timeline;
  if (!settings) return; // Fallback will be handled by default browser behavior if settings are missing

  let action = settings.wheel;
  if (isSecondary && isShift) action = settings.wheelSecondaryShift;
  else if (isSecondary) action = settings.wheelSecondary;
  else if (isShift) action = settings.wheelShift;

  if (action === 'none') {
    e.preventDefault();
    return;
  }

  // Calculate delta amount based on event
  const delta = isSecondary ? e.deltaX : e.deltaY;
  if (!Number.isFinite(delta) || delta === 0) return;

  if (action === 'scroll_vertical') {
    // Let browser handle vertical scrolling natively if it's the primary action without modifiers
    // This allows smooth scrolling and proper trackpad support
    if (!isShift && !isSecondary) return;

    e.preventDefault();
    // Use the Splitpanes content element for vertical scrolling
    const splitpanesEl = document.querySelector('.editor-splitpanes') as HTMLElement;
    if (splitpanesEl) {
      splitpanesEl.scrollTop += delta;
    }
    return;
  }

  if (action === 'scroll_horizontal') {
    // If browser is already scrolling horizontally (like trackpad swipe), let it handle it
    if (isSecondary && !isShift) return;

    e.preventDefault();
    el.scrollLeft += delta;
    return;
  }

  if (action === 'zoom_horizontal') {
    e.preventDefault();

    const prevZoom = timelineStore.timelineZoom;
    const dir = delta < 0 ? 1 : -1;
    const step = 3;
    const nextZoom = Math.min(100, Math.max(0, Math.round(prevZoom + dir * step)));

    const rect = el.getBoundingClientRect();
    const viewportX = e.clientX - rect.left;
    const prevScrollLeft = el.scrollLeft;
    const anchorPx = prevScrollLeft + viewportX;
    const anchorTimeUs = pxToTimeUs(anchorPx, prevZoom);

    applyZoomWithAnchor({
      nextZoom,
      anchor: {
        anchorTimeUs,
        anchorViewportX: viewportX,
      },
    });
    return;
  }

  if (action === 'zoom_vertical') {
    e.preventDefault();

    const dir = delta < 0 ? 1 : -1;
    const step = 10;

    const docTracks = timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined;
    if (!docTracks) return;

    for (const track of docTracks) {
      const currentHeight = trackHeights.value[track.id] ?? 40; // DEFAULT_TRACK_HEIGHT
      const nextHeight = Math.max(32, Math.min(300, currentHeight + dir * step)); // MIN/MAX from labels
      updateTrackHeight(track.id, nextHeight);
    }
    return;
  }
}

watch(
  () => timelineStore.timelineZoom,
  (nextZoom, prevZoom) => {
    const el = scrollEl.value;
    if (!el) return;
    if (!Number.isFinite(prevZoom)) return;
    if (nextZoom === prevZoom) return;

    const prevScrollLeft = el.scrollLeft;
    const viewportWidth = el.clientWidth;
    const anchor = pendingZoomAnchor.value ?? makePlayheadAnchor({ zoom: prevZoom });
    pendingZoomAnchor.value = null;

    requestAnimationFrame(() => {
      const nextScrollLeft = computeAnchoredScrollLeft({
        prevZoom,
        nextZoom,
        prevScrollLeft,
        viewportWidth,
        anchor,
      });
      el.scrollLeft = nextScrollLeft;
    });
  },
);

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
    :class="{
      'outline-2 outline-primary-500/60 -outline-offset-2 z-10':
        focusStore.isPanelFocused('timeline'),
    }"
    @pointerdown="focusStore.setMainFocus('timeline')"
  >
    <!-- Toolbar -->
    <TimelineToolbar
      @update:zoom="
        (v) =>
          applyZoomWithAnchor({
            nextZoom: v,
            anchor: makePlayheadAnchor({ zoom: timelineStore.timelineZoom }),
          })
      "
    />

    <ClientOnly>
      <Splitpanes
        class="flex flex-1 min-h-0 overflow-hidden editor-splitpanes"
        @resized="onTimelineSplitResize"
      >
        <Pane :size="timelineSplitSizes[0]" min-size="5" max-size="50">
          <TimelineTrackLabels
            :tracks="tracks"
            :track-heights="trackHeights"
            class="h-full border-r border-ui-border"
            @update:track-height="updateTrackHeight"
          />
        </Pane>
        <Pane :size="timelineSplitSizes[1]" min-size="50">
          <div
            ref="scrollEl"
            class="w-full h-full overflow-x-auto overflow-y-hidden relative"
            @wheel="onTimelineWheel"
          >
            <TimelineRuler
              class="h-7 border-b border-ui-border bg-ui-bg-elevated sticky top-0 z-10 cursor-pointer"
              :scroll-el="scrollEl"
              @mousedown="onTimeRulerMouseDown"
            />

            <!-- Tracks -->
            <TimelineTracks
              ref="timelineTracksRef"
              :tracks="tracks"
              :track-heights="trackHeights"
              :drag-preview="dragPreview"
              :move-preview="movePreview"
              :dragging-mode="draggingMode"
              :dragging-item-id="draggingItemId"
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
