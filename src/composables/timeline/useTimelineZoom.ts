import { onBeforeUnmount, watch, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import {
  computeAnchoredScrollLeft,
  pxToTimeUs,
  pxPerSecondToZoom,
} from '~/utils/timeline/geometry';
import { DEFAULT_TIMELINE_ZOOM_POSITION } from '~/utils/zoom';

export interface UseTimelineZoomOptions {
  scrollEl: Ref<HTMLElement | null>;
}

export function useTimelineZoom({ scrollEl }: UseTimelineZoomOptions) {
  const timelineStore = useTimelineStore();

  let pendingTimelineZoomDelta = 0;
  let timelineZoomFrameId = 0;
  let pendingAnchor: { anchorTimeUs: number; anchorViewportX: number } | null = null;
  let isInternalZoomUpdate = false;

  watch(
    () => timelineStore.timelineZoom,
    (nextZoom, prevZoom) => {
      if (isInternalZoomUpdate) {
        isInternalZoomUpdate = false;
        return;
      }
      if (!scrollEl.value || nextZoom === prevZoom) return;

      const rect = scrollEl.value.getBoundingClientRect();
      const anchorViewportX = rect.width / 2;
      const anchorTimeUs = pxToTimeUs(scrollEl.value.scrollLeft + anchorViewportX, prevZoom);

      const nextScrollLeft = computeAnchoredScrollLeft({
        prevZoom,
        nextZoom,
        prevScrollLeft: scrollEl.value.scrollLeft,
        viewportWidth: rect.width,
        anchor: {
          anchorTimeUs,
          anchorViewportX,
        },
      });
      scrollEl.value.scrollLeft = nextScrollLeft;
    },
  );

  function flushPendingTimelineZoom() {
    if (pendingTimelineZoomDelta === 0 || !scrollEl.value) {
      timelineZoomFrameId = 0;
      pendingAnchor = null;
      return;
    }

    const prevZoom = timelineStore.timelineZoom;
    const delta = pendingTimelineZoomDelta;
    pendingTimelineZoomDelta = 0;

    let nextZoom = Math.min(110, Math.max(0, prevZoom + delta));

    // Snap to 100% when crossing into the snap zone while scrolling
    const SNAP_THRESHOLD = 2.5;
    if (
      Math.abs(nextZoom - DEFAULT_TIMELINE_ZOOM_POSITION) < SNAP_THRESHOLD &&
      Math.abs(prevZoom - DEFAULT_TIMELINE_ZOOM_POSITION) >= SNAP_THRESHOLD
    ) {
      nextZoom = DEFAULT_TIMELINE_ZOOM_POSITION;
    }

    if (nextZoom === prevZoom) {
      timelineZoomFrameId = 0;
      pendingAnchor = null;
      return;
    }

    const rect = scrollEl.value.getBoundingClientRect();

    // Default to viewport center if no other anchor is provided
    let anchorTimeUs = pxToTimeUs(scrollEl.value.scrollLeft + rect.width / 2, prevZoom);
    let anchorViewportX = rect.width / 2;

    if (pendingAnchor) {
      anchorTimeUs = pendingAnchor.anchorTimeUs;
      anchorViewportX = pendingAnchor.anchorViewportX;
    }

    isInternalZoomUpdate = true;
    timelineStore.setTimelineZoomExact(nextZoom);

    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom,
      nextZoom,
      prevScrollLeft: scrollEl.value.scrollLeft,
      viewportWidth: rect.width,
      anchor: {
        anchorTimeUs,
        anchorViewportX,
      },
    });

    scrollEl.value.scrollLeft = nextScrollLeft;
    timelineZoomFrameId = 0;
    pendingAnchor = null;
  }

  function handleZoomWheel(
    delta: number,
    anchor?: { anchorTimeUs: number; anchorViewportX: number },
  ) {
    pendingTimelineZoomDelta += delta;
    if (anchor) {
      pendingAnchor = anchor;
    }
    if (!timelineZoomFrameId) {
      timelineZoomFrameId = window.requestAnimationFrame(flushPendingTimelineZoom);
    }
  }

  function fitTimelineZoom() {
    if (!scrollEl.value) return;

    const durationUs = timelineStore.duration;
    if (durationUs <= 0) {
      timelineStore.resetTimelineZoom();
      scrollEl.value.scrollLeft = 0;
      return;
    }

    const rect = scrollEl.value.getBoundingClientRect();
    const viewportWidth = rect.width;
    if (viewportWidth <= 0) return;

    // Add 5% padding on each side (total 10%)
    const desiredPPS = (viewportWidth * 0.9) / (durationUs / 1e6);

    const nextZoom = pxPerSecondToZoom(desiredPPS);

    isInternalZoomUpdate = true;
    timelineStore.setTimelineZoomExact(nextZoom);
    scrollEl.value.scrollLeft = 0;
  }

  onBeforeUnmount(() => {
    if (timelineZoomFrameId) {
      window.cancelAnimationFrame(timelineZoomFrameId);
    }
  });

  return {
    handleZoomWheel,
    fitTimelineZoom,
  };
}
