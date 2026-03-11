import { onBeforeUnmount, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { computeAnchoredScrollLeft } from '~/utils/timeline/geometry';

export interface UseTimelineZoomOptions {
  scrollEl: Ref<HTMLElement | null>;
}

export function useTimelineZoom({ scrollEl }: UseTimelineZoomOptions) {
  const timelineStore = useTimelineStore();

  let pendingTimelineZoomDelta = 0;
  let timelineZoomFrameId = 0;

  function flushPendingTimelineZoom() {
    if (pendingTimelineZoomDelta === 0 || !scrollEl.value) {
      timelineZoomFrameId = 0;
      return;
    }

    const prevZoom = timelineStore.timelineZoom;
    const delta = pendingTimelineZoomDelta;
    pendingTimelineZoomDelta = 0;

    const nextZoom = Math.min(110, Math.max(0, prevZoom + delta));
    if (nextZoom === prevZoom) {
      timelineZoomFrameId = 0;
      return;
    }

    const rect = scrollEl.value.getBoundingClientRect();
    // Default to playhead if no other anchor is provided
    const anchorTimeUs = timelineStore.currentTime;

    timelineStore.setTimelineZoomExact(nextZoom);

    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom,
      nextZoom,
      prevScrollLeft: scrollEl.value.scrollLeft,
      viewportWidth: rect.width,
      anchor: {
        anchorTimeUs,
        anchorViewportX: rect.width / 2,
      },
    });

    scrollEl.value.scrollLeft = nextScrollLeft;
    timelineZoomFrameId = 0;
  }

  function handleZoomWheel(delta: number) {
    pendingTimelineZoomDelta += delta;
    if (!timelineZoomFrameId) {
      timelineZoomFrameId = window.requestAnimationFrame(flushPendingTimelineZoom);
    }
  }

  onBeforeUnmount(() => {
    if (timelineZoomFrameId) {
      window.cancelAnimationFrame(timelineZoomFrameId);
    }
  });

  return {
    handleZoomWheel,
  };
}
