import { ref, onMounted, onBeforeUnmount } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
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

export function useTimelineInteraction(
  scrollEl: Ref<HTMLElement | null>,
  tracks: ComputedRef<TimelineTrack[]>,
) {
  const timelineStore = useTimelineStore();

  const isDraggingPlayhead = ref(false);
  const draggingItemId = ref<string | null>(null);
  const draggingTrackId = ref<string | null>(null);
  const draggingMode = ref<'move' | 'trim_start' | 'trim_end' | null>(null);
  const dragAnchorClientX = ref(0);
  const dragAnchorStartUs = ref(0);
  const dragLastAppliedQuantizedDeltaUs = ref(0);
  const hasPendingTimelinePersist = ref(false);
  const lastDragClientX = ref(0);
  const pendingDragClientX = ref<number | null>(null);

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
    dragLastAppliedQuantizedDeltaUs.value = 0;

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

    pendingDragClientX.value = null;
    dragRafId = null;

    if (!mode || !trackId || !itemId || clientX === null) return;

    if (mode === 'move') {
      const dxPx = clientX - dragAnchorClientX.value;
      const deltaUs = pxToDeltaUs(dxPx, timelineStore.timelineZoom);
      const startUs = Math.max(0, dragAnchorStartUs.value + deltaUs);
      try {
        timelineStore.applyTimeline(
          { type: 'move_item', trackId, itemId, startUs },
          { saveMode: 'none' },
        );
        hasPendingTimelinePersist.value = true;
      } catch {}
      return;
    }

    const fps = sanitizeFps(timelineStore.timelineDoc?.timebase?.fps);
    const dxPx = clientX - dragAnchorClientX.value;
    const rawDeltaUs = pxToDeltaUs(dxPx, timelineStore.timelineZoom);
    const quantizedDeltaUs = quantizeDeltaUsToFrames(rawDeltaUs, fps);
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
    scheduleDragApply();
  }

  function onGlobalMouseUp() {
    if (dragRafId !== null) {
      cancelAnimationFrame(dragRafId);
      dragRafId = null;
    }
    applyDragFromPendingClientX();

    if (hasPendingTimelinePersist.value) {
      void timelineStore.requestTimelineSave({ immediate: true });
      hasPendingTimelinePersist.value = false;
    }

    isDraggingPlayhead.value = false;
    draggingMode.value = null;
    draggingItemId.value = null;
    draggingTrackId.value = null;
    pendingDragClientX.value = null;

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
    onTimeRulerMouseDown,
    startPlayheadDrag,
    selectItem,
    startMoveItem,
    startTrimItem,
  };
}
