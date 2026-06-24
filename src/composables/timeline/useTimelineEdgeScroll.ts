import { onBeforeUnmount, watch } from 'vue';
import type { Ref } from 'vue';

const DEFAULT_EDGE_SCROLL_ZONE_PX = 50;
const DEFAULT_EDGE_SCROLL_MAX_SPEED_PX = 20;

export interface UseTimelineEdgeScrollOptions {
  scrollEl: Ref<HTMLElement | null>;
  isActive: Ref<boolean>;
  onScrollStep: () => void;
  /** Optional rect provider. Defaults to el.getBoundingClientRect(). */
  getRect?: (el: HTMLElement) => DOMRect | undefined;
  /** Distance from viewport edge (px) that starts auto-scroll. */
  zonePx?: number;
  /** Max pixels to scroll per frame while dragging near an edge. */
  maxSpeedPx?: number;
  /** Which axes to edge-scroll. Desktop uses horizontal only; mobile uses both. */
  axes?: { horizontal?: boolean; vertical?: boolean };
}

export function useTimelineEdgeScroll(options: UseTimelineEdgeScrollOptions) {
  const {
    scrollEl,
    isActive,
    onScrollStep,
    getRect = (el) => el.getBoundingClientRect?.(),
    zonePx = DEFAULT_EDGE_SCROLL_ZONE_PX,
    maxSpeedPx = DEFAULT_EDGE_SCROLL_MAX_SPEED_PX,
    axes = { horizontal: true, vertical: false },
  } = options;

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
    if (!el || !isActive.value) {
      edgeScrollRafId = 0;
      return;
    }
    if (axes.horizontal !== false) {
      el.scrollLeft += edgeScrollDx;
    }
    if (axes.vertical) {
      el.scrollTop += edgeScrollDy;
    }
    onScrollStep();
    edgeScrollRafId = requestAnimationFrame(edgeScrollStep);
  }

  function computeAxisDelta(distNear: number, distFar: number): { active: boolean; delta: number } {
    if (distNear < zonePx) {
      return {
        active: true,
        delta: -Math.round(maxSpeedPx * (1 - Math.max(0, distNear) / zonePx)),
      };
    }
    if (distFar < zonePx) {
      return {
        active: true,
        delta: Math.round(maxSpeedPx * (1 - Math.max(0, distFar) / zonePx)),
      };
    }
    return { active: false, delta: 0 };
  }

  function updateEdgeScroll(e: PointerEvent) {
    const el = scrollEl.value;
    if (!el || !isActive.value) {
      stopEdgeScroll();
      return;
    }

    const rect = getRect(el);
    if (!rect) {
      stopEdgeScroll();
      return;
    }

    let dx = 0;
    let dy = 0;
    let hasAxis = false;

    if (axes.horizontal !== false) {
      const horizontal = computeAxisDelta(e.clientX - rect.left, rect.right - e.clientX);
      if (horizontal.active) {
        dx = horizontal.delta;
        hasAxis = true;
      }
    }

    if (axes.vertical) {
      const vertical = computeAxisDelta(e.clientY - rect.top, rect.bottom - e.clientY);
      if (vertical.active) {
        dy = vertical.delta;
        hasAxis = true;
      }
    }

    if (hasAxis) {
      edgeScrollDx = dx;
      edgeScrollDy = dy;
      if (!edgeScrollRafId) edgeScrollRafId = requestAnimationFrame(edgeScrollStep);
    } else {
      stopEdgeScroll();
    }
  }

  watch(isActive, (val) => {
    if (!val) stopEdgeScroll();
  });

  onBeforeUnmount(() => {
    stopEdgeScroll();
  });

  return { updateEdgeScroll, stopEdgeScroll };
}
