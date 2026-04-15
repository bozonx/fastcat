import { watch, onBeforeUnmount, type Ref } from 'vue';

const EDGE_ZONE_PX = 60;
const MAX_SCROLL_SPEED = 14;

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
    if (distLeft >= 0 && distLeft < EDGE_ZONE_PX) {
      dx = -Math.round(MAX_SCROLL_SPEED * (1 - distLeft / EDGE_ZONE_PX));
    } else if (distRight >= 0 && distRight < EDGE_ZONE_PX) {
      dx = Math.round(MAX_SCROLL_SPEED * (1 - distRight / EDGE_ZONE_PX));
    }

    const distTop = e.clientY - rect.top;
    const distBottom = rect.bottom - e.clientY;
    if (distTop >= 0 && distTop < EDGE_ZONE_PX) {
      dy = -Math.round(MAX_SCROLL_SPEED * (1 - distTop / EDGE_ZONE_PX));
    } else if (distBottom >= 0 && distBottom < EDGE_ZONE_PX) {
      dy = Math.round(MAX_SCROLL_SPEED * (1 - distBottom / EDGE_ZONE_PX));
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
