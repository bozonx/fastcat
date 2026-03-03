<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useMediaStore } from '~/stores/media.store';
import { useFocusStore } from '~/stores/focus.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProjectStore } from '~/stores/project.store';
import type { TimelineTrack } from '~/timeline/types';
import { useTimelineInteraction } from '~/composables/timeline/useTimelineInteraction';
import {
  computeAnchoredScrollLeft,
  timeUsToPx,
  pxToTimeUs,
  type TimelineZoomAnchor,
} from '~/utils/timeline/geometry';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import { useLocalStorage } from '@vueuse/core';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { isSecondaryWheel, getWheelDelta } from '~/utils/mouse';

import TimelineTrackLabels from '~/components/timeline/TimelineTrackLabels.vue';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';
import TimelineRuler from '~/components/timeline/TimelineRuler.vue';

const { t } = useI18n();
const toast = useToast();


const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const { draggedFile, clearDraggedFile } = useDraggedFile();
const projectStore = useProjectStore();
const { currentProjectId, currentView } = storeToRefs(projectStore);

const timelineSplitKey = computed(() => `timeline-split-${currentView.value}`);

const { sizes: timelineSplitSizes, onResized: onTimelineSplitResize } = usePersistedSplitpanes(
  timelineSplitKey.value, // It's not fully reactive inside usePersistedSplitpanes, so we'll pass the base key
  currentProjectId,
  [10, 90],
);

const trackHeights = useLocalStorage<Record<string, number>>('gran-editor-track-heights-v1', {});

function updateTrackHeight(trackId: string, height: number) {
  trackHeights.value[trackId] = height;
}

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const scrollEl = ref<HTMLElement | null>(null);
const timelineTrackLabelsRef = ref<InstanceType<typeof TimelineTrackLabels> | null>(null);

function onScroll() {
  if (!scrollEl.value || !timelineTrackLabelsRef.value?.labelsScrollContainer) return;
  timelineTrackLabelsRef.value.labelsScrollContainer.scrollTop = scrollEl.value.scrollTop;
}

const pendingZoomAnchor = ref<TimelineZoomAnchor | null>(null);

const dragPreview = ref<{
  trackId: string;
  startUs: number;
  label: string;
  durationUs: number;
  kind: 'timeline-clip' | 'file';
} | null>(null);

const zoomFactor = computed(() => {
  const zoom = timelineStore.timelineZoom;
  const pos = Math.min(100, Math.max(0, zoom));
  const exponent = (pos - 50) / 10;
  const factor = Math.pow(2, exponent);
  return factor.toFixed(2);
});

let zoomTimeout: number | null = null;
const isZooming = ref(false);

watch(
  () => timelineStore.timelineZoom,
  () => {
    isZooming.value = true;
    if (zoomTimeout) clearTimeout(zoomTimeout);
    zoomTimeout = window.setTimeout(() => {
      isZooming.value = false;
    }, 1200);
  },
);

const {
  draggingMode,
  draggingItemId,
  movePreview,
  onTimeRulerPointerDown,
  startPlayheadDrag,
  selectItem,
  startMoveItem,
  startTrimItem,
} = useTimelineInteraction(scrollEl, tracks);

function getViewportWidth(): number {
  return scrollEl.value?.clientWidth ?? 0;
}

function makePlayheadAnchor(params: { zoom: number }): TimelineZoomAnchor {
  const viewportWidth = getViewportWidth();
  const prevScrollLeft = scrollEl.value?.scrollLeft ?? 0;
  const playheadPx = timeUsToPx(timelineStore.currentTime, params.zoom);
  const isVisible = playheadPx >= prevScrollLeft && playheadPx <= prevScrollLeft + viewportWidth;
  return {
    anchorTimeUs: timelineStore.currentTime,
    anchorViewportX: isVisible ? playheadPx - prevScrollLeft : viewportWidth / 2,
  };
}

function applyZoomWithAnchor(params: { nextZoom: number; anchor: TimelineZoomAnchor }) {
  // Store anchor for the watcher to use
  pendingZoomAnchor.value = params.anchor;
  timelineStore.setTimelineZoom(params.nextZoom);
}

const isPanning = ref(false);
const panStartX = ref(0);
const panStartScrollLeft = ref(0);

const clickStartX = ref(0);
const clickStartY = ref(0);

function onTimelinePointerDownCapture(e: PointerEvent) {
  if (e.button === 0) {
    clickStartX.value = e.clientX;
    clickStartY.value = e.clientY;
  }
}

function onTimelineClick(e: MouseEvent) {
  if (e.button !== 0) return;
  const dx = Math.abs(e.clientX - clickStartX.value);
  const dy = Math.abs(e.clientY - clickStartY.value);
  if (dx > 3 || dy > 3) return; // Ignore drag

  const target = e.target as HTMLElement | null;
  if (target?.closest('button')) return;
  if (target?.closest('.cursor-ew-resize')) return;
  if (target?.closest('.cursor-ns-resize')) return;

  const el = scrollEl.value;
  if (!el) return;
  const scrollerRect = el.getBoundingClientRect();
  const scrollX = el.scrollLeft;
  const x = e.clientX - scrollerRect.left + scrollX;

  timelineStore.currentTime = pxToTimeUs(x, timelineStore.timelineZoom);
}

function onTimelinePointerDown(e: PointerEvent) {
  if (e.button === 1) {
    // Middle click
    const settings = workspaceStore.userSettings.mouse.timeline;

    if (settings.middleClick === 'pan') {
      const el = scrollEl.value;
      if (!el) return;

      isPanning.value = true;
      panStartX.value = e.clientX;
      panStartScrollLeft.value = el.scrollLeft;

      (e.currentTarget as HTMLElement | null)?.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }
}

function onTimelinePointerMove(e: PointerEvent) {
  if (!isPanning.value) return;
  const el = scrollEl.value;
  if (!el) return;

  const dx = e.clientX - panStartX.value;
  // Move opposite to mouse direction for natural panning
  el.scrollLeft = Math.max(0, panStartScrollLeft.value - dx);
}

function onTimelinePointerUp(e: PointerEvent) {
  if (!isPanning.value) return;
  isPanning.value = false;
  try {
    (e.currentTarget as HTMLElement | null)?.releasePointerCapture(e.pointerId);
  } catch {
    // ignore
  }
}

function onTimelineRulerWheel(e: WheelEvent) {
  const el = scrollEl.value;
  if (!el) return;

  const isSecondary = isSecondaryWheel(e);
  const delta = getWheelDelta(e);
  if (!Number.isFinite(delta) || delta === 0) return;

  const settings = workspaceStore.userSettings.mouse.ruler;
  const action = isSecondary ? settings.wheelSecondary : settings.wheel;

  if (action === 'none') {
    e.preventDefault();
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
  } else if (action === 'scroll_horizontal') {
    e.preventDefault();
    el.scrollLeft += delta;
  }
}

function onTimelineWheel(e: WheelEvent) {
  const el = scrollEl.value;
  if (!el) return;

  const isShift = e.shiftKey;
  const isSecondary = isSecondaryWheel(e);

  const settings = workspaceStore.userSettings.mouse.timeline;

  let action = settings.wheel;
  if (isSecondary && isShift) action = settings.wheelSecondaryShift;
  else if (isSecondary) action = settings.wheelSecondary;
  else if (isShift) action = settings.wheelShift;

  if (action === 'none') {
    e.preventDefault();
    return;
  }

  // Calculate delta amount based on event
  const delta = getWheelDelta(e);
  if (!Number.isFinite(delta) || delta === 0) return;

  if (action === 'scroll_vertical') {
    // Let browser handle vertical scrolling natively if it's the primary action without modifiers
    // This allows smooth scrolling and proper trackpad support
    if (!isShift && !isSecondary) return;

    e.preventDefault();
    if (el) {
      el.scrollTop += delta;
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

// Single watcher handles scroll adjustment for ALL zoom changes
// (wheel zoom, hotkeys, toolbar slider)
watch(
  () => timelineStore.timelineZoom,
  (nextZoom, prevZoom) => {
    const el = scrollEl.value;
    if (!el) return;
    if (!Number.isFinite(prevZoom)) return;
    if (nextZoom === prevZoom) return;

    const prevScrollLeft = el.scrollLeft;
    const viewportWidth = el.clientWidth;
    // Use pending anchor from applyZoomWithAnchor, or fallback to playhead-based anchor
    const anchor = pendingZoomAnchor.value ?? makePlayheadAnchor({ zoom: prevZoom });
    pendingZoomAnchor.value = null;

    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom,
      nextZoom,
      prevScrollLeft,
      viewportWidth,
      anchor,
    });
    el.scrollLeft = nextScrollLeft;
  },
  { flush: 'post' },
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
  if (file.kind === 'adjustment' || file.kind === 'background' || file.kind === 'text') {
    durationUs = 5_000_000;
  } else if (file.kind !== 'timeline') {
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
    kind: file.kind === 'file' ? 'file' : 'timeline-clip',
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

  let parsed: any = null;
  const raw = e.dataTransfer?.getData('application/json');
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!parsed && draggedFile.value) {
    parsed = {
      kind: draggedFile.value.kind,
      name: draggedFile.value.name,
      path: draggedFile.value.path,
    };
  }

  const kind = typeof parsed?.kind === 'string' ? parsed.kind : undefined;
  if (
    kind &&
    kind !== 'file' &&
    kind !== 'timeline' &&
    kind !== 'adjustment' &&
    kind !== 'background' &&
    kind !== 'text'
  ) {
    clearDraggedFile();
    return;
  }

  const name = typeof parsed?.name === 'string' ? parsed.name : undefined;
  const path = typeof parsed?.path === 'string' ? parsed.path : undefined;
  const isVirtual = kind === 'adjustment' || kind === 'background' || kind === 'text';
  if (!name || (!isVirtual && !path)) {
    clearDraggedFile();
    return;
  }

  try {
    if (kind === 'adjustment' || kind === 'background' || kind === 'text') {
      timelineStore.addVirtualClipToTrack({
        trackId,
        startUs: startUs ?? timelineStore.currentTime,
        clipType: kind,
        name,
        text: kind === 'text' ? name : undefined,
      });
      await timelineStore.requestTimelineSave({ immediate: true });
    } else if (kind === 'timeline') {
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
      title: 'Clip Added',
      description: `${name} added to track`,
      icon: 'i-heroicons-check-circle',
      color: 'success',
    });

    void timelineMediaUsageStore.refreshUsage();
  } catch (err: any) {
    toast.add({
      title: t('common.error', 'Error'),
      description: String(err?.message ?? err ?? ''),
      icon: 'i-heroicons-exclamation-triangle',
      color: 'error',
    });
  } finally {
    clearDraggedFile();
  }
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
    <ClientOnly>
      <Splitpanes
        class="flex flex-1 min-h-0 overflow-hidden editor-splitpanes"
        @resized="onTimelineSplitResize"
      >
        <Pane :size="timelineSplitSizes[0]" min-size="5" max-size="50">
          <TimelineTrackLabels
            ref="timelineTrackLabelsRef"
            :tracks="tracks"
            :track-heights="trackHeights"
            class="h-full border-r border-ui-border"
            @update:track-height="updateTrackHeight"
          />
        </Pane>
        <Pane :size="timelineSplitSizes[1]" min-size="50">
          <div class="flex flex-col h-full w-full relative">
            <div class="relative shrink-0 z-10">
              <TimelineRuler
                class="h-7 border-b border-ui-border bg-ui-bg-elevated cursor-pointer w-full"
                :scroll-el="scrollEl"
                @pointerdown="onTimeRulerPointerDown"
                @start-playhead-drag="startPlayheadDrag"
                @wheel="onTimelineRulerWheel"
              />
            </div>
            <div
              ref="scrollEl"
              class="w-full flex-1 overflow-auto relative"
              @pointerdown.capture="onTimelinePointerDownCapture"
              @pointerdown.self="onTimelinePointerDown"
              @pointermove="onTimelinePointerMove"
              @pointerup="onTimelinePointerUp"
              @pointercancel="onTimelinePointerUp"
              @click="onTimelineClick"
              @wheel="onTimelineWheel"
              @scroll="onScroll"
            >
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
                @move-item="startMoveItem"
                @select-item="selectItem"
                @trim-item="startTrimItem"
                @clip-action="onClipAction"
              />

              <!-- Playhead -->
              <div
                class="absolute top-0 bottom-0 w-px bg-primary-500 cursor-ew-resize pointer-events-auto"
                :style="{
                  left: `${timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom)}px`,
                }"
                @pointerdown="startPlayheadDrag"
              ></div>
            </div>

            <!-- Zoom Indicator (bottom-right of timeline) -->
            <Transition
              enter-active-class="transition-opacity duration-200"
              enter-from-class="opacity-0"
              enter-to-class="opacity-100"
              leave-active-class="transition-opacity duration-300"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0"
            >
              <div
                v-show="isZooming"
                class="absolute bottom-2 right-3 px-2 py-1 text-xs font-mono rounded bg-ui-bg/90 border border-ui-border text-ui-text shadow-lg z-30 pointer-events-none backdrop-blur-sm"
              >
                ×{{ zoomFactor }}
              </div>
            </Transition>
          </div>
        </Pane>
      </Splitpanes>
    </ClientOnly>
  </div>
</template>
