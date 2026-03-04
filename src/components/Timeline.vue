<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
const trackAreaRef = ref<HTMLElement | null>(null);
const timelineTrackLabelsRef = ref<InstanceType<typeof TimelineTrackLabels> | null>(null);

// Reactive scroll position for playhead calculation (DOM scrollLeft is not reactive)
const scrollLeftRef = ref(0);

// Playhead position in pixels from left of scrollable content
const playheadPx = computed(() =>
  timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom),
);

// Offset playhead relative to the track area viewport accounting for scroll
const playheadLeft = computed(() => Math.round(playheadPx.value - scrollLeftRef.value));

const isLabelsScrolling = ref(false);

function onLabelsScroll() {
  if (!timelineTrackLabelsRef.value?.labelsScrollContainer) return;
  const labelsEl = timelineTrackLabelsRef.value.labelsScrollContainer;
  const el = scrollEl.value;
  if (!el) return;

  if (isLabelsScrolling.value) {
    isLabelsScrolling.value = false;
    return;
  }

  const maxScrollTop = el.scrollHeight - el.clientHeight;
  const labelsMaxScrollTop = labelsEl.scrollHeight - labelsEl.clientHeight;
  
  if (maxScrollTop > 0 && labelsMaxScrollTop > 0) {
    const ratio = labelsEl.scrollTop / labelsMaxScrollTop;
    isTimelineScrolling.value = true;
    el.scrollTop = Math.round(ratio * maxScrollTop);
  } else {
    isTimelineScrolling.value = true;
    el.scrollTop = labelsEl.scrollTop;
  }
}

const isTimelineScrolling = ref(false);

function onScroll() {
  const el = scrollEl.value;
  if (!el) return;
  scrollLeftRef.value = el.scrollLeft;
  
  // Sync label scroll: use ratio to handle different clientHeights
  const labelsEl = timelineTrackLabelsRef.value?.labelsScrollContainer;
  if (labelsEl) {
    if (isTimelineScrolling.value) {
      isTimelineScrolling.value = false;
      return;
    }

    const maxScrollTop = el.scrollHeight - el.clientHeight;
    const labelsMaxScrollTop = labelsEl.scrollHeight - labelsEl.clientHeight;
    if (maxScrollTop > 0 && labelsMaxScrollTop > 0) {
      const ratio = el.scrollTop / maxScrollTop;
      isLabelsScrolling.value = true;
      labelsEl.scrollTop = Math.round(ratio * labelsMaxScrollTop);
    } else {
      isLabelsScrolling.value = true;
      labelsEl.scrollTop = el.scrollTop;
    }
  }
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
  // Show as "x1.25" format
  return `x${factor.toFixed(2)}`;
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
  onGlobalPointerMove,
  onGlobalPointerUp,
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
  if (target?.closest('[data-clip-id]')) return;
  if (target?.closest('[data-gap-id]')) return;

  const el = scrollEl.value;
  if (!el) return;
  const scrollerRect = el.getBoundingClientRect();
  const scrollX = el.scrollLeft;
  const x = e.clientX - scrollerRect.left + scrollX;

  timelineStore.currentTime = pxToTimeUs(x, timelineStore.timelineZoom);
}

function onTimelinePointerDown(e: PointerEvent) {
  // Middle-click pan is handled by onTrackAreaPointerDownCapture (capture phase)
  // This handler is kept for future extension
}

function onTrackAreaPointerDownCapture(e: PointerEvent) {
  // Capture middle-click pan at track-area level so it fires even over clip elements
  if (e.button === 1) {
    const settings = workspaceStore.userSettings.mouse.timeline;
    if (settings.middleClick === 'pan') {
      e.preventDefault();
      startPan(e);
    }
  }
}

function startPan(e: PointerEvent) {
  const el = scrollEl.value;
  if (!el) return;

  isPanning.value = true;
  panStartX.value = e.clientX;
  panStartScrollLeft.value = el.scrollLeft;

  // Use trackAreaRef for pointer capture so pan works regardless of which element dispatched the event
  try {
    trackAreaRef.value?.setPointerCapture(e.pointerId);
  } catch {
    // ignore if pointer capture is unavailable
  }
  e.preventDefault();
}

function onTimelinePointerMove(e: PointerEvent) {
  onGlobalPointerMove(e);

  if (!isPanning.value) return;
  const el = scrollEl.value;
  if (!el) return;

  const dx = e.clientX - panStartX.value;
  // Move opposite to mouse direction for natural panning
  el.scrollLeft = Math.max(0, panStartScrollLeft.value - dx);
}

function onTimelinePointerUp(e: PointerEvent) {
  onGlobalPointerUp(e);

  if (!isPanning.value) return;
  isPanning.value = false;
  try {
    trackAreaRef.value?.releasePointerCapture(e.pointerId);
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
    // Programmatic scrollLeft doesn't fire scroll event, update manually
    scrollLeftRef.value = nextScrollLeft;
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
            @scroll="onLabelsScroll"
          />
        </Pane>
        <Pane :size="timelineSplitSizes[1]" min-size="50">
          <div
            ref="trackAreaRef"
            class="flex flex-col h-full w-full relative"
            @pointermove="onTimelinePointerMove"
            @pointerup="onTimelinePointerUp"
            @pointercancel="onTimelinePointerUp"
            @pointerdown.capture="onTrackAreaPointerDownCapture"
          >
            <div class="relative shrink-0 z-10">
              <TimelineRuler
                class="h-7 border-b border-ui-border bg-ui-bg-elevated cursor-pointer w-full"
                :scroll-el="scrollEl"
                @pointerdown="onTimeRulerPointerDown"
                @start-playhead-drag="startPlayheadDrag"
                @start-pan="startPan"
                @wheel="onTimelineRulerWheel"
              />
            </div>
            <div
              ref="scrollEl"
              class="w-full flex-1 overflow-auto relative timeline-scroll-el"
              @pointerdown.capture="onTimelinePointerDownCapture"
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
                @start-move-item="startMoveItem"
                @select-item="selectItem"
                @start-trim-item="startTrimItem"
                @clip-action="onClipAction"
              />
            </div>

            <!--
              Playhead overlay — positioned absolutely to the track-area container (not the
              scroll container), so it stays above all clips and spans the full visible height.
              The ruler height (h-7 = 28px) is subtracted from top so the line starts below ruler.
            -->
            <div
              class="absolute top-7 bottom-0 pointer-events-auto cursor-ew-resize"
              :style="{
                left: `${playheadLeft}px`,
                width: '1px',
                zIndex: 50,
                backgroundColor: 'var(--color-primary-500, #3b82f6)',
              }"
              @pointerdown="startPlayheadDrag"
            />

            <!-- Zoom indicator — absolute in bottom-right of visible track area -->
            <Transition
              enter-active-class="transition-opacity duration-150"
              enter-from-class="opacity-0"
              enter-to-class="opacity-100"
              leave-active-class="transition-opacity duration-500"
              leave-from-class="opacity-100"
              leave-to-class="opacity-0"
            >
              <div
                v-if="isZooming"
                class="absolute bottom-3 right-3 px-2.5 py-1 text-xs font-mono rounded-md bg-neutral-900/90 text-neutral-100 shadow-lg pointer-events-none z-50 select-none"
              >
                {{ zoomFactor }}
              </div>
            </Transition>
          </div>
        </Pane>
      </Splitpanes>
    </ClientOnly>
  </div>
</template>

<style scoped>
/*
  Use overlay-style scrollbars (drawn on top of content) to keep clientHeight
  consistent between tracks scroll-el and labels panel (which has no scrollbar).
  Falls back gracefully in browsers that don't support overlay.
*/
.timeline-scroll-el {
  scrollbar-width: thin;
}
</style>
