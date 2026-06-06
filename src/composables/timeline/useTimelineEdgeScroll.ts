import { onBeforeUnmount } from 'vue';
import type { Ref } from 'vue';

const EDGE_SCROLL_ZONE_PX = 50;
const EDGE_SCROLL_MAX_SPEED_PX = 20;

export function useTimelineEdgeScroll(
  scrollEl: Ref<HTMLElement | null>,
  isActive: Ref<boolean>,
  onScrollStep: () => void,
) {
  let edgeScrollRafId = 0;
  let edgeScrollDx = 0;

  function stopEdgeScroll() {
    if (edgeScrollRafId) {
      cancelAnimationFrame(edgeScrollRafId);
      edgeScrollRafId = 0;
    }
    edgeScrollDx = 0;
  }

  function edgeScrollStep() {
    const el = scrollEl.value;
    if (!el || !isActive.value) {
      edgeScrollRafId = 0;
      return;
    }
    el.scrollLeft += edgeScrollDx;
    onScrollStep();
    edgeScrollRafId = requestAnimationFrame(edgeScrollStep);
  }

  function updateEdgeScroll(e: PointerEvent) {
    const el = scrollEl.value;
    if (!el || !isActive.value) {
      stopEdgeScroll();
      return;
    }

    const rect = el.getBoundingClientRect?.();
    if (!rect) {
      stopEdgeScroll();
      return;
    }
    let dx = 0;

    const distLeft = e.clientX - rect.left;
    const distRight = rect.right - e.clientX;
    if (distLeft < EDGE_SCROLL_ZONE_PX) {
      dx = -Math.round(
        EDGE_SCROLL_MAX_SPEED_PX * (1 - Math.max(0, distLeft) / EDGE_SCROLL_ZONE_PX),
      );
    } else if (distRight < EDGE_SCROLL_ZONE_PX) {
      dx = Math.round(
        EDGE_SCROLL_MAX_SPEED_PX * (1 - Math.max(0, distRight) / EDGE_SCROLL_ZONE_PX),
      );
    }

    if (dx !== 0) {
      edgeScrollDx = dx;
      if (!edgeScrollRafId) edgeScrollRafId = requestAnimationFrame(edgeScrollStep);
    } else {
      stopEdgeScroll();
    }
  }

  onBeforeUnmount(() => {
    stopEdgeScroll();
  });

  return { updateEdgeScroll, stopEdgeScroll };
}
