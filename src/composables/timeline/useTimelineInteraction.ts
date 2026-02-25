import { ref, onMounted, onBeforeUnmount } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import type { TimelineTrack } from '~/timeline/types';

export const BASE_PX_PER_SECOND = 10;

export function zoomToPxPerSecond(zoom: number) {
  const parsed = Number(zoom);
  const safeZoom = Number.isFinite(parsed) ? parsed : 100;
  return (BASE_PX_PER_SECOND * safeZoom) / 100;
}

export function timeUsToPx(timeUs: number, zoom = 100) {
  const pxPerSecond = zoomToPxPerSecond(zoom);
  return (timeUs / 1e6) * pxPerSecond;
}

export function pxToTimeUs(px: number, zoom = 100) {
  const pxPerSecond = zoomToPxPerSecond(zoom);
  return Math.max(0, Math.round((px / pxPerSecond) * 1e6));
}

export function pxToDeltaUs(px: number, zoom = 100) {
  const pxPerSecond = zoomToPxPerSecond(zoom);
  return Math.round((px / pxPerSecond) * 1e6);
}

function sanitizeFps(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  const rounded = Math.round(parsed);
  if (rounded < 1) return 1;
  if (rounded > 240) return 240;
  return rounded;
}

function quantizeDeltaUsToFrames(deltaUs: number, fps: number): number {
  const safeDeltaUs = Number.isFinite(deltaUs) ? Math.round(deltaUs) : 0;
  const safeFps = sanitizeFps(fps);
  const framesFloat = (safeDeltaUs * safeFps) / 1e6;
  const frames = Math.round(framesFloat);
  return Math.round((frames * 1e6) / safeFps);
}

function quantizeStartUsToFrames(startUs: number, fps: number): number {
  const safeFps = sanitizeFps(fps);
  const frame = Math.round((Math.max(0, startUs) * safeFps) / 1e6);
  return Math.round((frame * 1e6) / safeFps);
}

/**
 * Returns the snapped startUs considering clip-snap and frame-snap settings.
 * @param rawStartUs - raw candidate position in microseconds
 * @param draggingItemId - id of item being dragged (excluded from snap targets)
 * @param fps - timeline fps
 * @param zoom - timeline zoom
 * @param snapThresholdPx - snap threshold in pixels
 * @param allTracks - all timeline tracks
 * @param enableFrameSnap - whether frame snapping is active
 * @param enableClipSnap - whether clip snapping is active
 */
function computeSnappedStartUs(params: {
  rawStartUs: number;
  draggingItemId: string;
  draggingItemDurationUs: number;
  fps: number;
  zoom: number;
  snapThresholdPx: number;
  allTracks: TimelineTrack[];
  enableFrameSnap: boolean;
  enableClipSnap: boolean;
  frameOffsetUs: number;
}): number {
  const {
    rawStartUs,
    draggingItemId,
    draggingItemDurationUs,
    fps,
    zoom,
    snapThresholdPx,
    allTracks,
    enableFrameSnap,
    enableClipSnap,
    frameOffsetUs,
  } = params;
  const thresholdUs = Math.round((snapThresholdPx / zoomToPxPerSecond(zoom)) * 1e6);

  let best = rawStartUs;
  let bestDist = thresholdUs;

  if (enableClipSnap) {
    // Snap targets: timeline start + all clip start/end positions (excluding dragged item)
    const snapTargets: number[] = [0];
    for (const track of allTracks) {
      for (const it of track.items) {
        if (it.id === draggingItemId || it.kind !== 'clip') continue;
        snapTargets.push(it.timelineRange.startUs);
        snapTargets.push(it.timelineRange.startUs + it.timelineRange.durationUs);
      }
    }

    const rawEndUs = rawStartUs + Math.max(0, Math.round(draggingItemDurationUs));

    for (const target of snapTargets) {
      const distStart = Math.abs(rawStartUs - target);
      if (distStart < bestDist) {
        bestDist = distStart;
        best = target;
      }

      const distEnd = Math.abs(rawEndUs - target);
      if (distEnd < bestDist) {
        bestDist = distEnd;
        best = target - Math.max(0, Math.round(draggingItemDurationUs));
      }
    }
  }

  if (enableFrameSnap && bestDist >= thresholdUs) {
    const offsetUs = Number.isFinite(frameOffsetUs) ? Math.round(frameOffsetUs) : 0;
    best = quantizeStartUsToFrames(rawStartUs - offsetUs, fps) + offsetUs;
  }

  return Math.max(0, best);
}

export interface TimelineMovePreview {
  itemId: string;
  trackId: string;
  startUs: number;
}

export function useTimelineInteraction(
  scrollEl: Ref<HTMLElement | null>,
  tracks: ComputedRef<TimelineTrack[]>,
) {
  const timelineStore = useTimelineStore();
  const settingsStore = useTimelineSettingsStore();

  const isDraggingPlayhead = ref(false);
  const draggingItemId = ref<string | null>(null);
  const draggingTrackId = ref<string | null>(null);
  const draggingMode = ref<'move' | 'trim_start' | 'trim_end' | null>(null);
  const dragAnchorClientX = ref(0);
  const dragAnchorStartUs = ref(0);
  const dragAnchorDurationUs = ref(0);
  const dragFrameOffsetUs = ref(0);
  const dragLastAppliedQuantizedDeltaUs = ref(0);
  const hasPendingTimelinePersist = ref(false);
  const lastDragClientX = ref(0);
  const pendingDragClientX = ref<number | null>(null);
  const pendingDragClientY = ref<number | null>(null);

  const movePreview = ref<TimelineMovePreview | null>(null);
  const pendingMoveCommit = ref<{
    fromTrackId: string;
    toTrackId: string;
    itemId: string;
    startUs: number;
  } | null>(null);

  let dragRafId: number | null = null;

  function onTimelineKeyDown(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (timelineStore.selectedItemIds.length > 0) {
        const items = tracks.value.flatMap((t) =>
          t.items.map((it) => ({ trackId: t.id, itemId: it.id })),
        );
        const firstSelection = items.find((it) =>
          timelineStore.selectedItemIds.includes(it.itemId),
        );
        if (firstSelection) {
          timelineStore.deleteSelectedItems(firstSelection.trackId);
        }
      }
    }
  }

  function getLocalX(e: MouseEvent): number {
    const target = e.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const scrollX = scrollEl.value?.scrollLeft ?? 0;
    if (!rect) return 0;
    return e.clientX - rect.left + scrollX;
  }

  function seekByMouseEvent(e: MouseEvent) {
    const x = getLocalX(e);
    timelineStore.currentTime = pxToTimeUs(x, timelineStore.timelineZoom);
  }

  function onTimeRulerMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    seekByMouseEvent(e);
    startPlayheadDrag(e);
  }

  function startPlayheadDrag(e: MouseEvent) {
    if (e.button !== 0) return;
    isDraggingPlayhead.value = true;
    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
  }

  function selectItem(e: MouseEvent, itemId: string) {
    e.stopPropagation();
    timelineStore.toggleSelection(itemId, { multi: e.shiftKey || e.metaKey || e.ctrlKey });
  }

  function startMoveItem(e: MouseEvent, trackId: string, itemId: string, startUs: number) {
    if (e.button !== 0) return;
    e.stopPropagation();

    if (!timelineStore.selectedItemIds.includes(itemId)) {
      timelineStore.toggleSelection(itemId);
    }

    draggingMode.value = 'move';
    draggingTrackId.value = trackId;
    draggingItemId.value = itemId;
    dragAnchorClientX.value = e.clientX;
    lastDragClientX.value = e.clientX;
    dragAnchorStartUs.value = startUs;
    dragAnchorDurationUs.value =
      tracks.value.find((t) => t.id === trackId)?.items.find((it) => it.id === itemId)
        ?.timelineRange.durationUs ?? 0;
    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
    const q = quantizeStartUsToFrames(startUs, fps);
    dragFrameOffsetUs.value = Math.round(startUs - q);
    dragLastAppliedQuantizedDeltaUs.value = 0;

    movePreview.value = {
      itemId,
      trackId,
      startUs,
    };
    pendingMoveCommit.value = null;

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
  }

  function startTrimItem(
    e: MouseEvent,
    input: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    draggingMode.value = input.edge === 'start' ? 'trim_start' : 'trim_end';
    draggingTrackId.value = input.trackId;
    draggingItemId.value = input.itemId;
    dragAnchorClientX.value = e.clientX;
    lastDragClientX.value = e.clientX;
    dragAnchorStartUs.value = input.startUs;
    dragLastAppliedQuantizedDeltaUs.value = 0;

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
  }

  function applyDragFromPendingClientX() {
    const mode = draggingMode.value;
    const trackId = draggingTrackId.value;
    const itemId = draggingItemId.value;
    const clientX = pendingDragClientX.value;
    const clientY = pendingDragClientY.value;

    pendingDragClientX.value = null;
    pendingDragClientY.value = null;
    dragRafId = null;

    if (!mode || !trackId || !itemId || clientX === null || clientY === null) return;

    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
    const zoom = timelineStore.timelineZoom;
    const enableFrameSnap = settingsStore.frameSnapMode === 'frames';
    const enableClipSnap = settingsStore.clipSnapMode === 'clips';
    const snapThresholdPx = settingsStore.snapThresholdPx;
    const overlapMode = settingsStore.overlapMode;

    if (mode === 'move') {
      const dxPx = clientX - dragAnchorClientX.value;
      const rawDeltaUs = pxToDeltaUs(dxPx, zoom);
      const rawStartUs = Math.max(0, dragAnchorStartUs.value + rawDeltaUs);

      const startUs = computeSnappedStartUs({
        rawStartUs,
        draggingItemId: itemId,
        draggingItemDurationUs: dragAnchorDurationUs.value,
        fps,
        zoom,
        snapThresholdPx,
        allTracks: tracks.value,
        enableFrameSnap,
        enableClipSnap,
        frameOffsetUs: dragFrameOffsetUs.value,
      });

      const trackEl = document.elementFromPoint(clientX, clientY)?.closest('[data-track-id]');
      const hoverTrackId = trackEl?.getAttribute('data-track-id');
      let targetTrackId = trackId;

      if (hoverTrackId && hoverTrackId !== trackId) {
        const fromTrack = tracks.value.find((t) => t.id === trackId);
        const toTrack = tracks.value.find((t) => t.id === hoverTrackId);
        if (fromTrack && toTrack && fromTrack.kind === toTrack.kind) {
          targetTrackId = hoverTrackId;
        }
      }

      if (overlapMode === 'pseudo') {
        movePreview.value = { itemId, trackId: targetTrackId, startUs };
        pendingMoveCommit.value = {
          fromTrackId: trackId,
          toTrackId: targetTrackId,
          itemId,
          startUs,
        };
        draggingTrackId.value = targetTrackId;
        return;
      }

      try {
        timelineStore.applyTimeline(
          {
            type: 'move_item_to_track',
            fromTrackId: trackId,
            toTrackId: targetTrackId,
            itemId,
            startUs,
          },
          { saveMode: 'none' },
        );
        draggingTrackId.value = targetTrackId;
        hasPendingTimelinePersist.value = true;
      } catch {}
      return;
    }

    // Trim modes
    const dxPx = clientX - dragAnchorClientX.value;
    const rawDeltaUs = pxToDeltaUs(dxPx, zoom);

    let quantizedDeltaUs: number;
    if (enableFrameSnap) {
      quantizedDeltaUs = quantizeDeltaUsToFrames(rawDeltaUs, fps);
    } else {
      quantizedDeltaUs = rawDeltaUs;
    }

    const nextStepDeltaUs = quantizedDeltaUs - dragLastAppliedQuantizedDeltaUs.value;

    lastDragClientX.value = clientX;

    if (nextStepDeltaUs === 0) return;
    dragLastAppliedQuantizedDeltaUs.value = quantizedDeltaUs;

    if (mode === 'trim_start') {
      try {
        timelineStore.applyTimeline(
          { type: 'trim_item', trackId, itemId, edge: 'start', deltaUs: nextStepDeltaUs },
          { saveMode: 'none' },
        );
        hasPendingTimelinePersist.value = true;
      } catch {}
      return;
    }

    if (mode === 'trim_end') {
      try {
        timelineStore.applyTimeline(
          { type: 'trim_item', trackId, itemId, edge: 'end', deltaUs: nextStepDeltaUs },
          { saveMode: 'none' },
        );
        hasPendingTimelinePersist.value = true;
      } catch {}
    }
  }

  function scheduleDragApply() {
    if (dragRafId !== null) return;
    dragRafId = requestAnimationFrame(() => {
      applyDragFromPendingClientX();
    });
  }

  function onGlobalMouseMove(e: MouseEvent) {
    if (isDraggingPlayhead.value) {
      const scrollerRect = scrollEl.value?.getBoundingClientRect();
      if (!scrollerRect) return;
      const scrollX = scrollEl.value?.scrollLeft ?? 0;
      const x = e.clientX - scrollerRect.left + scrollX;
      timelineStore.currentTime = pxToTimeUs(x, timelineStore.timelineZoom);
      return;
    }

    const mode = draggingMode.value;
    const trackId = draggingTrackId.value;
    const itemId = draggingItemId.value;
    if (!mode || !trackId || !itemId) return;

    pendingDragClientX.value = e.clientX;
    pendingDragClientY.value = e.clientY;
    scheduleDragApply();
  }

  function onGlobalMouseUp() {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
    applyDragFromPendingClientX();

    if (draggingMode.value === 'move' && settingsStore.overlapMode === 'pseudo') {
      const commit = pendingMoveCommit.value;
      if (commit) {
        try {
          timelineStore.applyTimeline(
            {
              type: 'overlay_place_item',
              fromTrackId: commit.fromTrackId,
              toTrackId: commit.toTrackId,
              itemId: commit.itemId,
              startUs: commit.startUs,
            },
            { saveMode: 'none' },
          );
          hasPendingTimelinePersist.value = true;
        } catch {}
      }
    }

    if (hasPendingTimelinePersist.value) {
      void timelineStore.requestTimelineSave({ immediate: true });
      hasPendingTimelinePersist.value = false;
    }

    isDraggingPlayhead.value = false;
    draggingMode.value = null;
    draggingItemId.value = null;
    draggingTrackId.value = null;
    pendingDragClientX.value = null;
    pendingDragClientY.value = null;

    movePreview.value = null;
    pendingMoveCommit.value = null;

    window.removeEventListener('mousemove', onGlobalMouseMove);
    window.removeEventListener('mouseup', onGlobalMouseUp);
  }

  onMounted(() => {
    window.addEventListener('keydown', onTimelineKeyDown);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onTimelineKeyDown);
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
    window.removeEventListener('mousemove', onGlobalMouseMove);
    window.removeEventListener('mouseup', onGlobalMouseUp);
  });

  return {
    isDraggingPlayhead,
    movePreview,
    onTimeRulerMouseDown,
    startPlayheadDrag,
    selectItem,
    startMoveItem,
    startTrimItem,
  };
}
