import type { ComputedRef, Ref } from 'vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useHistoryStore } from '~/stores/history.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import { selectTimelineDurationUs } from '~/timeline/selectors';

export const BASE_PX_PER_SECOND = 10;

export function zoomToPxPerSecond(zoom: number) {
  const parsed = Number(zoom);
  const safePos = Number.isFinite(parsed) ? parsed : 50;
  const pos = Math.min(100, Math.max(0, safePos));

  // Logarithmic scale where 50 => 1x. Each 10 points ~= 2x change.
  // pxPerSecond = BASE * 2 ^ ((pos - 50) / 10)
  const exponent = (pos - 50) / 10;
  const factor = Math.pow(2, exponent);
  return BASE_PX_PER_SECOND * factor;
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

function sanitizeSnapTargetsUs(targets: number[]): number[] {
  const result: number[] = [];
  for (const v of targets) {
    if (!Number.isFinite(v)) continue;
    result.push(Math.max(0, Math.round(v)));
  }
  result.sort((a, b) => a - b);
  // Deduplicate
  const uniq: number[] = [];
  for (const x of result) {
    if (uniq.length === 0 || uniq[uniq.length - 1] !== x) uniq.push(x);
  }
  return uniq;
}

function pickBestSnapCandidateUs(params: {
  rawUs: number;
  thresholdUs: number;
  targetsUs: number[];
}): { snappedUs: number; distUs: number } {
  const rawUs = Math.round(params.rawUs);
  let best = rawUs;
  let bestDist = Math.max(0, Math.round(params.thresholdUs));
  for (const target of params.targetsUs) {
    const dist = Math.abs(rawUs - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = target;
    }
  }
  return { snappedUs: best, distUs: bestDist };
}

/**
 * Returns the snapped startUs considering clip-snap and frame-snap settings.
 * @param rawStartUs - raw candidate position in microseconds
 * @param fps - timeline fps
 * @param zoom - timeline zoom
 * @param snapThresholdPx - snap threshold in pixels
 * @param snapTargetsUs - precomputed snap targets in microseconds
 * @param enableFrameSnap - whether frame snapping is active
 * @param enableClipSnap - whether clip snapping is active
 */
function computeSnappedStartUs(params: {
  rawStartUs: number;
  draggingItemDurationUs: number;
  fps: number;
  zoom: number;
  snapThresholdPx: number;
  snapTargetsUs: number[];
  enableFrameSnap: boolean;
  enableClipSnap: boolean;
  frameOffsetUs: number;
}): number {
  const {
    rawStartUs,
    draggingItemDurationUs,
    fps,
    zoom,
    snapThresholdPx,
    snapTargetsUs,
    enableFrameSnap,
    enableClipSnap,
    frameOffsetUs,
  } = params;
  const thresholdUs = Math.round((snapThresholdPx / zoomToPxPerSecond(zoom)) * 1e6);

  let best = rawStartUs;
  let bestDist = thresholdUs;

  if (enableClipSnap) {
    const rawEndUs = rawStartUs + Math.max(0, Math.round(draggingItemDurationUs));

    for (const target of snapTargetsUs) {
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

function computeSnapTargetsUs(params: {
  tracks: TimelineTrack[];
  excludeItemId: string;
  includeTimelineStart: boolean;
  includeTimelineEndUs: number | null;
  includePlayheadUs: number | null;
}): number[] {
  const targets: number[] = [];
  if (params.includeTimelineStart) targets.push(0);
  if (
    typeof params.includeTimelineEndUs === 'number' &&
    Number.isFinite(params.includeTimelineEndUs)
  ) {
    targets.push(params.includeTimelineEndUs);
  }
  if (typeof params.includePlayheadUs === 'number' && Number.isFinite(params.includePlayheadUs)) {
    targets.push(params.includePlayheadUs);
  }

  for (const track of params.tracks) {
    for (const it of track.items) {
      if (it.kind !== 'clip') continue;
      if (it.id === params.excludeItemId) continue;
      targets.push(it.timelineRange.startUs);
      targets.push(it.timelineRange.startUs + it.timelineRange.durationUs);
    }
  }

  return sanitizeSnapTargetsUs(targets);
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
  const historyStore = useHistoryStore();
  const settingsStore = useTimelineSettingsStore();

  const isDraggingPlayhead = ref(false);
  const draggingItemId = ref<string | null>(null);
  const draggingTrackId = ref<string | null>(null);
  const dragOriginTrackId = ref<string | null>(null);
  const draggingMode = ref<'move' | 'trim_start' | 'trim_end' | null>(null);
  const dragAnchorClientX = ref(0);
  const dragAnchorStartUs = ref(0);
  const dragAnchorDurationUs = ref(0);
  const dragFrameOffsetUs = ref(0);
  const dragLastAppliedQuantizedDeltaUs = ref(0);
  const dragSnapTargetsUs = ref<number[]>([]);
  const dragAnchorItemDurationUs = ref(0);
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

  const dragStartSnapshot = ref<import('~/timeline/types').TimelineDocument | null>(null);
  const lastDragAppliedCmd = ref<import('~/timeline/commands').TimelineCommand | null>(null);
  const dragCancelRequested = ref(false);

  let dragRafId: number | null = null;

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
    window.addEventListener('keydown', onGlobalKeyDown);
  }

  function selectItem(e: MouseEvent, itemId: string) {
    e.stopPropagation();
    timelineStore.toggleSelection(itemId, { multi: e.shiftKey || e.metaKey || e.ctrlKey });
  }

  function startMoveItem(e: MouseEvent, trackId: string, itemId: string, startUs: number) {
    if (e.button !== 0) return;
    e.stopPropagation();

    const item = tracks.value.find((t) => t.id === trackId)?.items.find((it) => it.id === itemId);
    if (item?.kind === 'clip' && Boolean((item as any).locked)) return;

    if (!timelineStore.selectedItemIds.includes(itemId)) {
      timelineStore.toggleSelection(itemId);
    }

    draggingMode.value = 'move';
    draggingTrackId.value = trackId;
    dragOriginTrackId.value = trackId;
    draggingItemId.value = itemId;
    dragAnchorClientX.value = e.clientX;
    lastDragClientX.value = e.clientX;
    dragAnchorStartUs.value = startUs;
    dragAnchorDurationUs.value =
      tracks.value.find((t) => t.id === trackId)?.items.find((it) => it.id === itemId)
        ?.timelineRange.durationUs ?? 0;
    dragAnchorItemDurationUs.value = dragAnchorDurationUs.value;
    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
    const q = quantizeStartUsToFrames(startUs, fps);
    dragFrameOffsetUs.value = Math.round(startUs - q);
    dragLastAppliedQuantizedDeltaUs.value = 0;

    const timelineEndUs = Number.isFinite(timelineStore.duration)
      ? Math.max(0, Math.round(timelineStore.duration))
      : null;
    dragSnapTargetsUs.value = computeSnapTargetsUs({
      tracks: tracks.value,
      excludeItemId: itemId,
      includeTimelineStart: true,
      includeTimelineEndUs: timelineEndUs,
      includePlayheadUs: timelineStore.currentTime,
    });

    dragStartSnapshot.value = timelineStore.timelineDoc;
    lastDragAppliedCmd.value = null;
    dragCancelRequested.value = false;

    movePreview.value = {
      itemId,
      trackId,
      startUs,
    };
    pendingMoveCommit.value = null;

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('keydown', onGlobalKeyDown);
  }

  function startTrimItem(
    e: MouseEvent,
    input: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const item = tracks.value
      .find((t) => t.id === input.trackId)
      ?.items.find((it) => it.id === input.itemId);
    if (item?.kind === 'clip' && Boolean((item as any).locked)) return;

    draggingMode.value = input.edge === 'start' ? 'trim_start' : 'trim_end';
    draggingTrackId.value = input.trackId;
    draggingItemId.value = input.itemId;
    dragAnchorClientX.value = e.clientX;
    lastDragClientX.value = e.clientX;
    dragAnchorStartUs.value = input.startUs;
    dragLastAppliedQuantizedDeltaUs.value = 0;

    const currentItem = tracks.value
      .find((t) => t.id === input.trackId)
      ?.items.find((it) => it.id === input.itemId);
    const durationUs = currentItem?.kind === 'clip' ? currentItem.timelineRange.durationUs : 0;
    dragAnchorItemDurationUs.value = Math.max(0, Math.round(Number(durationUs ?? 0)));

    const timelineEndUs = Number.isFinite(timelineStore.duration)
      ? Math.max(0, Math.round(timelineStore.duration))
      : null;
    dragSnapTargetsUs.value = computeSnapTargetsUs({
      tracks: tracks.value,
      excludeItemId: input.itemId,
      includeTimelineStart: true,
      includeTimelineEndUs: timelineEndUs,
      includePlayheadUs: timelineStore.currentTime,
    });

    dragCancelRequested.value = false;

    window.addEventListener('mousemove', onGlobalMouseMove);
    window.addEventListener('mouseup', onGlobalMouseUp);
    window.addEventListener('keydown', onGlobalKeyDown);
  }

  function onGlobalKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;

    const hasActiveDrag = Boolean(draggingMode.value) || isDraggingPlayhead.value;
    if (!hasActiveDrag) return;

    dragCancelRequested.value = true;
    e.preventDefault();
    onGlobalMouseUp();
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
        draggingItemDurationUs: dragAnchorDurationUs.value,
        fps,
        zoom,
        snapThresholdPx,
        snapTargetsUs: dragSnapTargetsUs.value,
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
          fromTrackId: dragOriginTrackId.value ?? trackId,
          toTrackId: targetTrackId,
          itemId,
          startUs,
        };
        draggingTrackId.value = targetTrackId;
        return;
      }

      try {
        const cmd = {
          type: 'move_item_to_track',
          fromTrackId: trackId,
          toTrackId: targetTrackId,
          itemId,
          startUs,
        } as const;
        timelineStore.applyTimeline(cmd, { saveMode: 'none', skipHistory: true });
        lastDragAppliedCmd.value = cmd as any;
        draggingTrackId.value = targetTrackId;
        hasPendingTimelinePersist.value = true;
      } catch {}
      return;
    }

    // Trim modes
    const dxPx = clientX - dragAnchorClientX.value;
    const rawDeltaUs = pxToDeltaUs(dxPx, zoom);

    const thresholdUs = Math.round((snapThresholdPx / zoomToPxPerSecond(zoom)) * 1e6);
    const anchorStartUs = Math.max(0, Math.round(dragAnchorStartUs.value));
    const anchorDurationUs = Math.max(0, Math.round(dragAnchorItemDurationUs.value));
    const anchorEndUs = anchorStartUs + anchorDurationUs;

    const rawEdgeUs = mode === 'trim_start' ? anchorStartUs + rawDeltaUs : anchorEndUs + rawDeltaUs;

    let snappedEdgeUs = Math.round(rawEdgeUs);
    let bestDist = thresholdUs;

    if (enableClipSnap) {
      const clipSnap = pickBestSnapCandidateUs({
        rawUs: rawEdgeUs,
        thresholdUs,
        targetsUs: dragSnapTargetsUs.value,
      });
      snappedEdgeUs = clipSnap.snappedUs;
      bestDist = clipSnap.distUs;
    }

    if (enableFrameSnap && bestDist >= thresholdUs) {
      snappedEdgeUs = quantizeStartUsToFrames(rawEdgeUs, fps);
    }

    // Convert snapped edge back to delta relative to current edge (so we stay compatible with timeline commands)
    const desiredDeltaUs =
      mode === 'trim_start' ? snappedEdgeUs - anchorStartUs : snappedEdgeUs - anchorEndUs;
    const desiredQuantizedDeltaUs = enableFrameSnap
      ? quantizeDeltaUsToFrames(desiredDeltaUs, fps)
      : Math.round(desiredDeltaUs);

    const nextStepDeltaUs = desiredQuantizedDeltaUs - dragLastAppliedQuantizedDeltaUs.value;
    lastDragClientX.value = clientX;
    if (nextStepDeltaUs === 0) return;
    dragLastAppliedQuantizedDeltaUs.value = desiredQuantizedDeltaUs;

    const cmdEdge = mode === 'trim_start' ? 'start' : 'end';
    const cmdType = overlapMode === 'pseudo' ? 'overlay_trim_item' : 'trim_item';

    try {
      const cmd = {
        type: cmdType as any,
        trackId,
        itemId,
        edge: cmdEdge,
        deltaUs: nextStepDeltaUs,
      } as any;
      timelineStore.applyTimeline(cmd, { saveMode: 'none', skipHistory: true });
      lastDragAppliedCmd.value = cmd as any;
      hasPendingTimelinePersist.value = true;
    } catch {
      // Keep last applied quantized delta unchanged on failure? We intentionally keep it,
      // so the user can continue dragging and we only apply deltas when possible.
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
      if (e.buttons === 0) {
        onGlobalMouseUp();
        return;
      }
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

    if (e.buttons === 0) {
      onGlobalMouseUp();
      return;
    }

    pendingDragClientX.value = e.clientX;
    pendingDragClientY.value = e.clientY;
    scheduleDragApply();
  }

  function onGlobalMouseUp() {
    const cancel = dragCancelRequested.value;
    dragCancelRequested.value = false;

    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }

    if (!cancel) {
      applyDragFromPendingClientX();
    }

    if (!cancel && draggingMode.value === 'move' && settingsStore.overlapMode === 'pseudo') {
      const commit = pendingMoveCommit.value;
      if (commit) {
        try {
          const cmd = {
            type: 'overlay_place_item',
            fromTrackId: commit.fromTrackId,
            toTrackId: commit.toTrackId,
            itemId: commit.itemId,
            startUs: commit.startUs,
          } as const;
          timelineStore.applyTimeline(cmd as any, { saveMode: 'none', skipHistory: true });
          lastDragAppliedCmd.value = cmd as any;
          hasPendingTimelinePersist.value = true;
        } catch {}
      }
    }

    const snapshot = dragStartSnapshot.value;
    const appliedCmd = lastDragAppliedCmd.value;
    const currDoc = timelineStore.timelineDoc;
    if (!cancel && snapshot && appliedCmd && currDoc && snapshot !== currDoc) {
      historyStore.push(appliedCmd as any, snapshot as any);
    }

    if (cancel && snapshot) {
      timelineStore.timelineDoc = snapshot as any;
      timelineStore.duration = selectTimelineDurationUs(snapshot as any) as any;
    }

    if (!cancel && hasPendingTimelinePersist.value) {
      void timelineStore.requestTimelineSave({ immediate: true });
      hasPendingTimelinePersist.value = false;
    }

    isDraggingPlayhead.value = false;
    draggingMode.value = null;
    draggingItemId.value = null;
    draggingTrackId.value = null;
    dragOriginTrackId.value = null;
    pendingDragClientX.value = null;
    pendingDragClientY.value = null;

    movePreview.value = null;
    pendingMoveCommit.value = null;

    dragStartSnapshot.value = null;
    lastDragAppliedCmd.value = null;

    window.removeEventListener('mousemove', onGlobalMouseMove);
    window.removeEventListener('mouseup', onGlobalMouseUp);
    window.removeEventListener('keydown', onGlobalKeyDown);
  }

  onMounted(() => {});

  onBeforeUnmount(() => {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
    window.removeEventListener('mousemove', onGlobalMouseMove);
    window.removeEventListener('mouseup', onGlobalMouseUp);
    window.removeEventListener('keydown', onGlobalKeyDown);
  });

  return {
    isDraggingPlayhead,
    draggingMode,
    draggingItemId,
    movePreview,
    onTimeRulerMouseDown,
    startPlayheadDrag,
    selectItem,
    startMoveItem,
    startTrimItem,
  };
}
