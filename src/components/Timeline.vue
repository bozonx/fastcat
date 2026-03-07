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
import { isTimelineTextDropFileName } from '~/utils/timeline/textDrop';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import {
  computeAnchoredScrollLeft,
  timeUsToPx,
  pxToTimeUs,
  type TimelineZoomAnchor,
  sanitizeSnapTargetsUs,
  computeSnappedStartUs,
} from '~/utils/timeline/geometry';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { Splitpanes, Pane } from 'splitpanes';
import 'splitpanes/dist/splitpanes.css';
import { useLocalStorage, useResizeObserver } from '@vueuse/core';
import { usePersistedSplitpanes } from '~/composables/ui/usePersistedSplitpanes';
import { isSecondaryWheel, getWheelDelta } from '~/utils/mouse';
import { formatZoomMultiplier, stepTimelineZoomPosition, timelineZoomPositionToScale } from '~/utils/zoom';
import { frameToUs, sanitizeFps } from '~/timeline/commands/utils';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';

import TimelineTrackLabels from '~/components/timeline/TimelineTrackLabels.vue';
import TimelineTracks from '~/components/timeline/TimelineTracks.vue';
import TimelineRuler from '~/components/timeline/TimelineRuler.vue';
import TimelineGrid from '~/components/timeline/TimelineGrid.vue';

const { t } = useI18n();
const toast = useToast();

const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();
const timelineMediaUsageStore = useTimelineMediaUsageStore();
const timelineSettingsStore = useTimelineSettingsStore();
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

const canEditClipContent = computed(
  () =>
    currentView.value === 'cut' ||
    currentView.value === 'files' ||
    currentView.value === 'sound',
);
const canDropTimelineContent = computed(
  () => currentView.value === 'files' || currentView.value === 'cut',
);

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const scrollEl = ref<HTMLElement | null>(null);
const trackAreaRef = ref<HTMLElement | null>(null);
const timelineTrackLabelsRef = ref<InstanceType<typeof TimelineTrackLabels> | null>(null);

// Reactive scroll position for playhead calculation (DOM scrollLeft is not reactive)
const scrollLeftRef = ref(0);

// Height of horizontal scrollbar in scrollEl (used to compensate labels panel height)
const scrollbarHeight = ref(0);
useResizeObserver(
  () => scrollEl.value,
  () => {
    const el = scrollEl.value;
    if (el) {
      scrollbarHeight.value = el.offsetHeight - el.clientHeight;
    }
  },
);

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

  isTimelineScrolling.value = true;
  el.scrollTop = labelsEl.scrollTop;
}

const isTimelineScrolling = ref(false);

function onScroll() {
  const el = scrollEl.value;
  if (!el) return;
  scrollLeftRef.value = el.scrollLeft;

  const labelsEl = timelineTrackLabelsRef.value?.labelsScrollContainer;
  if (labelsEl) {
    if (isTimelineScrolling.value) {
      isTimelineScrolling.value = false;
      return;
    }

    isLabelsScrolling.value = true;
    labelsEl.scrollTop = el.scrollTop;
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
  return formatZoomMultiplier(timelineZoomPositionToScale(timelineStore.timelineZoom));
});

const TIMELINE_ZOOM_WHEEL_STEP_DELTA = 100;

let zoomTimeout: number | null = null;
const isZooming = ref(false);
let pendingTimelineZoomDelta = 0;
let timelineZoomFrameId: number | null = null;
let pendingTimelineZoomAnchor: TimelineZoomAnchor | null = null;

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

function getNormalizedWheelDelta(e: WheelEvent): number {
  const delta = getWheelDelta(e);
  if (!Number.isFinite(delta) || delta === 0) return 0;

  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return delta * 16;
  }

  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return delta * Math.max(getViewportWidth(), 1);
  }

  return delta;
}

function stepTimelineZoomPositionByCount(currentZoom: number, stepCount: number): number {
  if (!Number.isFinite(currentZoom) || stepCount === 0) return currentZoom;

  const direction = stepCount > 0 ? 1 : -1;
  let nextZoom = currentZoom;

  for (let index = 0; index < Math.abs(stepCount); index += 1) {
    const steppedZoom = stepTimelineZoomPosition(nextZoom, direction);
    if (steppedZoom === nextZoom) break;
    nextZoom = steppedZoom;
  }

  return nextZoom;
}

function flushPendingTimelineZoom() {
  timelineZoomFrameId = null;

  const anchor = pendingTimelineZoomAnchor;
  const accumulatedDelta = pendingTimelineZoomDelta;
  if (!anchor || accumulatedDelta === 0) return;

  const rawStepCount = accumulatedDelta / TIMELINE_ZOOM_WHEEL_STEP_DELTA;
  const stepCount = rawStepCount > 0 ? Math.floor(rawStepCount) : Math.ceil(rawStepCount);

  if (stepCount === 0) {
    return;
  }

  pendingTimelineZoomDelta -= stepCount * TIMELINE_ZOOM_WHEEL_STEP_DELTA;
  if (Math.abs(pendingTimelineZoomDelta) < 1) {
    pendingTimelineZoomDelta = 0;
  }

  const prevZoom = timelineStore.timelineZoom;
  const nextZoom = stepTimelineZoomPositionByCount(prevZoom, stepCount);

  if (nextZoom !== prevZoom) {
    applyZoomWithAnchor({
      nextZoom,
      anchor,
    });
  } else {
    pendingTimelineZoomDelta = 0;
  }

  if (pendingTimelineZoomDelta !== 0) {
    timelineZoomFrameId = window.requestAnimationFrame(flushPendingTimelineZoom);
  }
}

function queueTimelineZoom(params: { delta: number; anchor: TimelineZoomAnchor }) {
  if (!Number.isFinite(params.delta) || params.delta === 0) return;

  pendingTimelineZoomDelta += params.delta;
  pendingTimelineZoomAnchor = params.anchor;

  if (timelineZoomFrameId !== null) return;
  timelineZoomFrameId = window.requestAnimationFrame(flushPendingTimelineZoom);
}

function seekByWheelDelta(delta: number) {
  if (!Number.isFinite(delta) || delta === 0) return;

  const direction = delta < 0 ? 1 : -1;
  const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
  const frameStepUs = frameToUs(1, fps);

  return {
    frame: () => timelineStore.setCurrentTimeUs(timelineStore.currentTime + direction * frameStepUs),
    second: () => timelineStore.setCurrentTimeUs(timelineStore.currentTime + direction * 1_000_000),
  };
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

  // If click is below the last track row, select timeline properties.
  // Keep playhead placement behavior for clicks within the track rows.
  const scrollerRectY = el.getBoundingClientRect();
  const y = e.clientY - scrollerRectY.top + el.scrollTop;
  const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  const totalTracksHeight = docTracks.reduce((sum, tr) => {
    const h = trackHeights.value[tr.id] ?? 40;
    return sum + h;
  }, 0);
  if (y > totalTracksHeight) {
    timelineStore.selectTimelineProperties();
    return;
  }

  const scrollerRect = el.getBoundingClientRect();
  const scrollX = el.scrollLeft;
  const x = e.clientX - scrollerRect.left + scrollX;

  timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
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

  const isShift = isLayer1Active(e, workspaceStore.userSettings);
  const isSecondary = isSecondaryWheel(e);
  const delta = getNormalizedWheelDelta(e);
  if (!Number.isFinite(delta) || delta === 0) return;

  const settings = workspaceStore.userSettings.mouse.ruler;
  let action = settings.wheel;
  if (isSecondary && isShift) action = settings.wheelSecondaryShift;
  else if (isSecondary) action = settings.wheelSecondary;
  else if (isShift) action = settings.wheelShift;

  if (action === 'none') {
    e.preventDefault();
    return;
  }

  if (action === 'zoom_horizontal') {
    e.preventDefault();

    const rect = el.getBoundingClientRect();
    const viewportX = e.clientX - rect.left;
    const prevScrollLeft = el.scrollLeft;
    const anchorPx = prevScrollLeft + viewportX;
    const anchorTimeUs = pxToTimeUs(anchorPx, timelineStore.timelineZoom);

    queueTimelineZoom({
      delta: -delta,
      anchor: {
        anchorTimeUs,
        anchorViewportX: viewportX,
      },
    });
  } else if (action === 'scroll_horizontal') {
    e.preventDefault();
    el.scrollLeft += delta;
  } else if (action === 'seek_frame') {
    e.preventDefault();
    seekByWheelDelta(delta)?.frame();
  } else if (action === 'seek_second') {
    e.preventDefault();
    seekByWheelDelta(delta)?.second();
  }
}

function onTimelineWheel(e: WheelEvent) {
  const el = scrollEl.value;
  if (!el) return;

  const isShift = isLayer1Active(e, workspaceStore.userSettings);
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
  const delta = getNormalizedWheelDelta(e);
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

    const rect = el.getBoundingClientRect();
    const viewportX = e.clientX - rect.left;
    const prevScrollLeft = el.scrollLeft;
    const anchorPx = prevScrollLeft + viewportX;
    const anchorTimeUs = pxToTimeUs(anchorPx, timelineStore.timelineZoom);

    queueTimelineZoom({
      delta: -delta,
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

  if (action === 'seek_frame') {
    e.preventDefault();
    seekByWheelDelta(delta)?.frame();
    return;
  }

  if (action === 'seek_second') {
    e.preventDefault();
    seekByWheelDelta(delta)?.second();
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

watch(
  () => scrollEl.value,
  (nextEl, prevEl) => {
    if (nextEl || !prevEl) return;

    if (timelineZoomFrameId !== null) {
      window.cancelAnimationFrame(timelineZoomFrameId);
      timelineZoomFrameId = null;
    }

    pendingTimelineZoomDelta = 0;
    pendingTimelineZoomAnchor = null;
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

function computeDropSnapTargetsUs(): number[] {
  const targets: number[] = [];
  targets.push(0);

  if (Number.isFinite(timelineStore.duration)) {
    targets.push(Math.max(0, Math.round(timelineStore.duration)));
  }

  if (Number.isFinite(timelineStore.currentTime)) {
    targets.push(Math.max(0, Math.round(timelineStore.currentTime)));
  }

  for (const m of timelineStore.getMarkers()) {
    if (!Number.isFinite(m.timeUs)) continue;
    targets.push(m.timeUs);
    if (typeof m.durationUs === 'number' && Number.isFinite(m.durationUs)) {
      targets.push(m.timeUs + m.durationUs);
    }
  }

  for (const tr of tracks.value) {
    for (const it of tr.items) {
      if (it.kind !== 'clip') continue;
      targets.push(it.timelineRange.startUs);
      targets.push(it.timelineRange.startUs + it.timelineRange.durationUs);
    }
  }

  return sanitizeSnapTargetsUs(targets);
}

function computeSnappedDropStartUs(rawStartUs: number, draggingItemDurationUs: number): number {
  const fps = timelineStore.timelineDoc?.timebase?.fps ?? 0;
  const enableFrameSnap = timelineSettingsStore.frameSnapMode === 'frames';
  const enableClipSnap = timelineSettingsStore.clipSnapMode === 'clips';

  return computeSnappedStartUs({
    rawStartUs,
    draggingItemDurationUs,
    fps,
    zoom: timelineStore.timelineZoom,
    snapThresholdPx: timelineSettingsStore.snapThresholdPx,
    snapTargetsUs: computeDropSnapTargetsUs(),
    enableFrameSnap,
    enableClipSnap,
    frameOffsetUs: 0,
  });
}

function onTrackDragOver(e: DragEvent, trackId: string) {
  if (!canDropTimelineContent.value) {
    clearDragPreview();
    return;
  }

  const startUs = getDropStartUs(e);
  if (startUs === null) return;

  const file = draggedFile.value;
  if (!file) {
    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (droppedFiles.length === 0) {
      clearDragPreview();
      return;
    }

    const textFiles = droppedFiles.filter((f) => isTimelineTextDropFileName(f.name));
    if (textFiles.length > 0) {
      dragPreview.value = {
        trackId,
        startUs,
        label: textFiles.length === 1 ? textFiles[0]!.name : `${textFiles.length} text clips`,
        durationUs: 5_000_000 * textFiles.length,
        kind: 'timeline-clip',
      };
      return;
    }

    // Default to a short preview if we just have random external files
    dragPreview.value = {
      trackId,
      startUs,
      label: droppedFiles.length === 1 ? droppedFiles[0]!.name : `${droppedFiles.length} files`,
      durationUs: 5_000_000 * droppedFiles.length,
      kind: 'file',
    };
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

  const count = file.count ?? 1;
  // If multiple items are selected in the file manager, they will be dragged together
  if (count > 1) {
    // Just estimate duration since we only know the metadata for the primary file
    durationUs = durationUs * count;
  }

  dragPreview.value = {
    trackId,
    startUs: computeSnappedDropStartUs(startUs, durationUs),
    label: count > 1 ? `${count} items` : file.name,
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
  if (!canDropTimelineContent.value) {
    clearDragPreview();
    clearDraggedFile();
    return;
  }

  clearDragPreview();
  const startUs = getDropStartUs(e);

  // Snapshot files synchronously - dataTransfer can become empty after await
  const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
  const textFiles = droppedFiles.filter((f) => isTimelineTextDropFileName(f.name));
  if (textFiles.length > 0) {
    try {
      const baseStartUs = startUs ?? timelineStore.currentTime;
      let cursorStartUs = baseStartUs;
      const durationUs = 5_000_000;

      for (const f of textFiles) {
        const text = await f.text();
        timelineStore.addVirtualClipToTrack({
          trackId,
          startUs: cursorStartUs,
          clipType: 'text',
          name: f.name,
          text,
        });
        cursorStartUs += durationUs;
      }

      await timelineStore.requestTimelineSave({ immediate: true });

      toast.add({
        title: 'Clip Added',
        description:
          textFiles.length === 1
            ? `${textFiles[0]!.name} added to track`
            : `${textFiles.length} text clips added to track`,
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
    return;
  }

  let itemsToDrop: Array<{ kind: string; name: string; path?: string }> = [];

  const moveRaw = e.dataTransfer?.getData('application/gran-file-manager-move');
  if (moveRaw) {
    try {
      const parsed = JSON.parse(moveRaw);
      itemsToDrop = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // ignore
    }
  }

  if (itemsToDrop.length === 0) {
    let parsed: any = null;
    const raw = e.dataTransfer?.getData('application/json');
    if (raw) {
      try {
        parsed = JSON.parse(raw);
        itemsToDrop = [parsed];
      } catch {
        parsed = null;
      }
    }

    if (itemsToDrop.length === 0 && draggedFile.value) {
      itemsToDrop = [
        {
          kind: draggedFile.value.kind,
          name: draggedFile.value.name,
          path: draggedFile.value.path,
        },
      ];
    }
  }

  const validItems = itemsToDrop.filter((item) => {
    const k = typeof item?.kind === 'string' ? item.kind : undefined;
    return (
      k === 'file' ||
      k === 'timeline' ||
      k === 'adjustment' ||
      k === 'background' ||
      k === 'text'
    );
  });

  if (validItems.length === 0) {
    clearDraggedFile();
    return;
  }

  try {
    let currentStartUs = startUs ?? timelineStore.currentTime;
    currentStartUs = computeSnappedDropStartUs(currentStartUs, dragPreview.value?.durationUs ?? 0);
    let addedCount = 0;

    for (const item of validItems) {
      const kind = item.kind;
      const name = typeof item.name === 'string' ? item.name : undefined;
      const path = typeof item.path === 'string' ? item.path : undefined;
      const isVirtual = kind === 'adjustment' || kind === 'background' || kind === 'text';
      
      if (!name || (!isVirtual && !path)) continue;

      try {
        const isFirst = addedCount === 0;
        const options = isFirst 
          ? { historyMode: 'immediate' as const, label: validItems.length > 1 ? `Add ${validItems.length} clips` : `Add ${name}` }
          : { skipHistory: true, saveMode: 'none' as const };

        if (kind === 'adjustment' || kind === 'background' || kind === 'text') {
          const res = timelineStore.addVirtualClipToTrack({
            trackId,
            startUs: currentStartUs,
            clipType: kind,
            name,
            text: kind === 'text' ? name : undefined,
          }, options);
          currentStartUs += 5_000_000;
          addedCount++;
        } else if (kind === 'timeline') {
          const res = await timelineStore.addTimelineClipToTimelineFromPath({
            trackId,
            name,
            path: path!,
            startUs: currentStartUs,
          }, options);
          currentStartUs += res.durationUs;
          addedCount++;
        } else {
          const mediaType = getMediaTypeFromFilename(name || path || '');
          if (mediaType === 'text' && path) {
            const handle = await projectStore.getFileHandleByPath(path);
            if (handle && handle.kind === 'file') {
              const file = await (handle as FileSystemFileHandle).getFile();
              const text = await file.text();
              timelineStore.addVirtualClipToTrack({
                trackId,
                startUs: currentStartUs,
                clipType: 'text',
                name,
                text,
              }, options);
              currentStartUs += 5_000_000;
              addedCount++;
            }
          } else {
            const res = await timelineStore.addClipToTimelineFromPath({
              trackId,
              name,
              path: path!,
              startUs: currentStartUs,
            }, options);
            currentStartUs += res.durationUs;
            addedCount++;
          }
        }
      } catch (err: any) {
        // If it's a single file drag, show the error immediately
        if (validItems.length === 1) {
          throw err;
        }
        // For multiple files, just ignore the error (filter out invalid files silently)
        console.warn(`Could not add ${name} to track:`, err);
      }
    }

    if (addedCount > 0) {
      await timelineStore.requestTimelineSave({ immediate: true });

      toast.add({
        title: 'Clip Added',
        description: addedCount === 1 
          ? `${validItems.find(i => typeof i.name === 'string')?.name ?? 'Clip'} added to track`
          : `${addedCount} clips added to track`,
        icon: 'i-heroicons-check-circle',
        color: 'success',
      });
      void timelineMediaUsageStore.refreshUsage();
    }
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
    @pointerdown.capture="focusStore.setMainFocus('timeline')"
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
            :scrollbar-compensation="scrollbarHeight"
            class="h-full border-r border-ui-border"
            @update:track-height="updateTrackHeight"
            @scroll="onLabelsScroll"
          />
        </Pane>
        <Pane :size="timelineSplitSizes[1]" min-size="50">
          <div
            ref="trackAreaRef"
            class="flex flex-col h-full w-full relative min-h-0"
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
                :can-edit-clip-content="canEditClipContent"
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

          <!-- Grid lines overlaid on tracks area, below ruler -->
            <TimelineGrid
              class="absolute left-0 right-0 pointer-events-none"
              :style="{ top: '28px', bottom: `${scrollbarHeight}px` }"
              :scroll-el="scrollEl"
            />

            <!--
              Playhead overlay — positioned absolutely to the track-area container (not the
              scroll container), so it stays above all clips and spans the full visible height.
              The ruler height (h-7 = 28px) is subtracted from top so the line starts below ruler.
            -->
            <div
              class="absolute bottom-0 pointer-events-none"
              :style="{
                top: '27px',
                left: `${playheadLeft}px`,
                width: '1px',
                zIndex: 50,
                backgroundColor: 'var(--color-primary-500, #3b82f6)',
              }"
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
                class="absolute bottom-2 right-3 px-2 py-1 text-xs font-mono font-semibold rounded-md bg-neutral-900/90 text-neutral-100 shadow-lg backdrop-blur-sm pointer-events-none select-none"
                :style="{ zIndex: 60 }"
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
  scrollbar-color: var(--ui-border-accent, #666) transparent;
}

.timeline-scroll-el::-webkit-scrollbar {
  height: 10px;
  width: 10px;
}

.timeline-scroll-el::-webkit-scrollbar-track {
  background: transparent;
}

.timeline-scroll-el::-webkit-scrollbar-thumb {
  background: var(--ui-border, #444);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.timeline-scroll-el::-webkit-scrollbar-thumb:hover {
  background: var(--ui-border-accent, #666);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
</style>
