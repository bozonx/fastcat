import { watch, onBeforeUnmount, type Ref } from 'vue';
import {
  MOBILE_EDGE_SCROLL_ZONE_PX,
  MOBILE_EDGE_SCROLL_MAX_SPEED_PX,
} from '~/utils/mobile/timeline';

export function useMobileTimelineEdgeScroll(
  scrollEl: Ref<HTMLElement | null>,
  draggingMode: Ref<string | null>,
  scheduleDragReapply: () => void,
  getCachedScrollRect: (el: HTMLElement) => DOMRect,
) {
  let edgeScrollRafId = 0;
  let edgeScrollDx = 0;
  let edgeScrollDy = 0;

  function stopEdgeScroll() {
    if (edgeScrollRafId) {
      cancelAnimationFrame(edgeScrollRafId);
      edgeScrollRafId = 0;
    }
    edgeScrollDx = 0;
    edgeScrollDy = 0;
  }

  function edgeScrollStep() {
    const el = scrollEl.value;
    if (!el || !draggingMode.value) {
      edgeScrollRafId = 0;
      return;
    }
    el.scrollLeft += edgeScrollDx;
    el.scrollTop += edgeScrollDy;
    scheduleDragReapply();
    edgeScrollRafId = requestAnimationFrame(edgeScrollStep);
  }

  function updateEdgeScroll(e: PointerEvent) {
    const el = scrollEl.value;
    if (!el || !draggingMode.value) {
      stopEdgeScroll();
      return;
    }

    const rect = getCachedScrollRect(el);
    let dx = 0;
    let dy = 0;

    const distLeft = e.clientX - rect.left;
    const distRight = rect.right - e.clientX;
    if (distLeft < MOBILE_EDGE_SCROLL_ZONE_PX) {
      dx = -Math.round(
        MOBILE_EDGE_SCROLL_MAX_SPEED_PX * (1 - Math.max(0, distLeft) / MOBILE_EDGE_SCROLL_ZONE_PX),
      );
    } else if (distRight < MOBILE_EDGE_SCROLL_ZONE_PX) {
      dx = Math.round(
        MOBILE_EDGE_SCROLL_MAX_SPEED_PX * (1 - Math.max(0, distRight) / MOBILE_EDGE_SCROLL_ZONE_PX),
      );
    }

    const distTop = e.clientY - rect.top;
    const distBottom = rect.bottom - e.clientY;
    if (distTop < MOBILE_EDGE_SCROLL_ZONE_PX) {
      dy = -Math.round(
        MOBILE_EDGE_SCROLL_MAX_SPEED_PX * (1 - Math.max(0, distTop) / MOBILE_EDGE_SCROLL_ZONE_PX),
      );
    } else if (distBottom < MOBILE_EDGE_SCROLL_ZONE_PX) {
      dy = Math.round(
        MOBILE_EDGE_SCROLL_MAX_SPEED_PX *
          (1 - Math.max(0, distBottom) / MOBILE_EDGE_SCROLL_ZONE_PX),
      );
    }

    if (dx !== 0 || dy !== 0) {
      edgeScrollDx = dx;
      edgeScrollDy = dy;
      if (!edgeScrollRafId) edgeScrollRafId = requestAnimationFrame(edgeScrollStep);
    } else {
      stopEdgeScroll();
    }
  }

  watch(
    () => draggingMode.value,
    (val) => {
      if (!val) stopEdgeScroll();
    },
  );

  onBeforeUnmount(() => {
    stopEdgeScroll();
  });

  return {
    updateEdgeScroll,
    stopEdgeScroll,
  };
}
