import { ref, onMounted, onBeforeUnmount, watch, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import {
  computeAnchoredScrollLeft,
  timeUsToPx,
  pxToTimeUs,
  type TimelineZoomAnchor,
} from '~/utils/timeline/geometry';
import {
  MIN_TIMELINE_ZOOM_POSITION,
  MAX_TIMELINE_ZOOM_POSITION,
  timelineZoomPositionToScale,
  timelineZoomScaleToPosition,
} from '~/utils/zoom';

export function useMobileTimelineZoom(
  scrollEl: Ref<HTMLElement | null>,
  getCachedScrollRect: (el: HTMLElement) => DOMRect,
) {
  const timelineStore = useTimelineStore();
  const pendingZoomAnchor = ref<TimelineZoomAnchor | null>(null);

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
    pendingZoomAnchor.value = params.anchor;
    timelineStore.setTimelineZoom(params.nextZoom);
  }

  let initialDistance = 0;
  let initialZoomPosition = 1;

  function getDistance(touches: TouchList) {
    const t0 = touches[0] as Touch;
    const t1 = touches[1] as Touch;
    const dx = t0.clientX - t1.clientX;
    const dy = t0.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      initialDistance = getDistance(e.touches);
      initialZoomPosition = timelineStore.timelineZoom;
    }
  }

  function onTouchMove(e: TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault();
      const currentDistance = getDistance(e.touches);
      if (initialDistance === 0) return;

      const initialScale = timelineZoomPositionToScale(initialZoomPosition);
      const scaleRatio = currentDistance / initialDistance;
      const nextScale = initialScale * scaleRatio;
      const nextZoomPosition = timelineZoomScaleToPosition(nextScale);

      const el = scrollEl.value;
      if (el) {
        const rect = getCachedScrollRect(el);
        const midpointX = ((e.touches[0] as Touch).clientX + (e.touches[1] as Touch).clientX) / 2;
        const viewportX = midpointX - rect.left;
        const anchorPx = el.scrollLeft + viewportX;
        const anchorTimeUs = pxToTimeUs(anchorPx, initialZoomPosition);

        applyZoomWithAnchor({
          nextZoom: nextZoomPosition,
          anchor: { anchorTimeUs, anchorViewportX: viewportX },
        });
      }
    }
  }

  // Handles trackpad pinch and Chrome DevTools Shift+drag (both fire wheel with ctrlKey=true).
  // deltaY < 0 = pinch out = zoom in; deltaY > 0 = pinch in = zoom out.
  function onScrollElWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();

    const el = scrollEl.value;
    if (!el) return;

    const rect = getCachedScrollRect(el);
    const anchorViewportX = e.clientX - rect.left;
    const anchorTimeUs = pxToTimeUs(el.scrollLeft + anchorViewportX, timelineStore.timelineZoom);

    const step = e.deltaY > 0 ? -5 : 5;
    const nextZoom = Math.min(
      MAX_TIMELINE_ZOOM_POSITION,
      Math.max(MIN_TIMELINE_ZOOM_POSITION, timelineStore.timelineZoom + step),
    );

    applyZoomWithAnchor({ nextZoom, anchor: { anchorTimeUs, anchorViewportX } });
  }

  // Ensure the playhead starts in view if zooming happens from other causes
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

  onMounted(() => {
    scrollEl.value?.addEventListener('wheel', onScrollElWheel, { passive: false });
  });

  onBeforeUnmount(() => {
    scrollEl.value?.removeEventListener('wheel', onScrollElWheel);
  });

  return {
    onTouchStart,
    onTouchMove,
  };
}
