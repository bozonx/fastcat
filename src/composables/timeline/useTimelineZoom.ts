import { TICKS_PER_SECOND } from '~/utils/time';
import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import {
  computeAnchoredScrollLeft,
  pxToTimeTicks,
  pxPerSecondToZoom,
} from '~/utils/timeline/geometry';
import { DEFAULT_TIMELINE_ZOOM_POSITION } from '~/utils/zoom';
import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('timeline-zoom-perf');

/**
 * Dev-only zoom-commit profiler. Toggle in the console with
 * `localStorage.fastcatPerfZoom = '1'` (and reload). Logs, per committed zoom
 * step: the synchronous commit cost, the time until Vue finished patching the
 * DOM (`nextTick`), and the time until the browser painted the next frame. Use
 * it to see whether the 1–2s stall lives in JS (commit/patch) or in
 * layout/paint (paint delta dominates).
 */
function isZoomPerfEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('fastcatPerfZoom') === '1';
  } catch {
    return false;
  }
}

function profileZoomCommit(prevZoom: number, nextZoom: number, commitMs: number) {
  if (!isZoomPerfEnabled()) return;
  const start = performance.now();
  void nextTick().then(() => {
    const patchedMs = performance.now() - start;
    requestAnimationFrame(() => {
      const paintedMs = performance.now() - start;
      log.debug(
        `zoom ${prevZoom.toFixed(1)}→${nextZoom.toFixed(1)} | commit ${commitMs.toFixed(
          1,
        )}ms | patch ${patchedMs.toFixed(1)}ms | paint ${paintedMs.toFixed(1)}ms`,
      );
    });
  });
}

export interface UseTimelineZoomOptions {
  scrollEl: Ref<HTMLElement | null>;
}

export function useTimelineZoom({ scrollEl }: UseTimelineZoomOptions) {
  const timelineStore = useTimelineStore();

  let pendingTimelineZoomDelta = 0;
  let timelineZoomFrameId = 0;
  let pendingAnchor: { anchorTimeTicks: number; anchorViewportX: number } | null = null;
  let isInternalZoomUpdate = false;
  let scrollApplyTicket = 0;

  /**
   * Commit an anchored zoom scroll offset in a *single* render pass.
   *
   * The store's `timelineScrollLeftPx` is the real driver of the content
   * transform + clip windowing; the native `scrollEl.scrollLeft` only positions
   * the scrollbar thumb. Previously we set the zoom now and the scroll offset
   * after `nextTick()`, which forced two full re-renders of every visible clip
   * per zoom step. Writing the store offset synchronously lets Vue batch it with
   * the zoom change into one pass. We only touch the native scrollbar (and read
   * back its clamped value) after the width spacer has resized.
   */
  function commitAnchoredScrollLeft(nextScrollLeft: number) {
    // Synchronous store write — batched with the zoom change into one render.
    timelineStore.timelineScrollLeftPx = nextScrollLeft;
    void syncNativeScrollAfterRender(nextScrollLeft);
  }

  async function syncNativeScrollAfterRender(target: number) {
    const ticket = ++scrollApplyTicket;

    await nextTick();

    if (ticket !== scrollApplyTicket || !scrollEl.value) return;

    scrollEl.value.scrollLeft = target;
    // The browser clamps scrollLeft to the (now resized) scroll width. Only
    // re-write the store — and trigger a second render — when it actually
    // clamped to a different value (e.g. zooming out at the far-right edge).
    const actual = scrollEl.value.scrollLeft;
    if (actual !== timelineStore.timelineScrollLeftPx) {
      timelineStore.timelineScrollLeftPx = actual;
    }
  }

  watch(
    () => timelineStore.timelineZoom,
    (nextZoom, prevZoom) => {
      if (isInternalZoomUpdate) {
        isInternalZoomUpdate = false;
        return;
      }
      if (!scrollEl.value || nextZoom === prevZoom) return;

      const t0 = performance.now();
      const rect = scrollEl.value.getBoundingClientRect();
      const anchorViewportX = rect.width / 2;
      const anchorTimeTicks = pxToTimeTicks(scrollEl.value.scrollLeft + anchorViewportX, prevZoom);

      const nextScrollLeft = computeAnchoredScrollLeft({
        prevZoom,
        nextZoom,
        prevScrollLeft: scrollEl.value.scrollLeft,
        viewportWidth: rect.width,
        anchor: {
          anchorTimeTicks,
          anchorViewportX,
        },
      });
      // Zoom already changed reactively (external caller); commit the matching
      // scroll offset synchronously so both land in the same render pass.
      commitAnchoredScrollLeft(nextScrollLeft);
      profileZoomCommit(prevZoom, nextZoom, performance.now() - t0);
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

    const t0 = performance.now();
    const rect = scrollEl.value.getBoundingClientRect();

    // Default to viewport center if no other anchor is provided
    let anchorTimeTicks = pxToTimeTicks(scrollEl.value.scrollLeft + rect.width / 2, prevZoom);
    let anchorViewportX = rect.width / 2;

    if (pendingAnchor) {
      anchorTimeTicks = pendingAnchor.anchorTimeTicks;
      anchorViewportX = pendingAnchor.anchorViewportX;
    }

    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom,
      nextZoom,
      prevScrollLeft: scrollEl.value.scrollLeft,
      viewportWidth: rect.width,
      anchor: {
        anchorTimeTicks,
        anchorViewportX,
      },
    });

    // Commit zoom + scroll synchronously so the (expensive) clip re-render runs
    // exactly once for this step. `isInternalZoomUpdate` keeps the zoom watcher
    // from re-deriving a second scroll offset off the same change.
    isInternalZoomUpdate = true;
    timelineStore.setTimelineZoomExact(nextZoom);
    commitAnchoredScrollLeft(nextScrollLeft);

    profileZoomCommit(prevZoom, nextZoom, performance.now() - t0);

    timelineZoomFrameId = 0;
    pendingAnchor = null;
  }

  function handleZoomWheel(
    delta: number,
    anchor?: { anchorTimeTicks: number; anchorViewportX: number },
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

    const durationTicks = timelineStore.duration;
    if (durationTicks <= 0) {
      timelineStore.resetTimelineZoom();
      commitAnchoredScrollLeft(0);
      return;
    }

    const rect = scrollEl.value.getBoundingClientRect();
    const viewportWidth = rect.width;
    if (viewportWidth <= 0) return;

    // Add 5% padding on each side (total 10%)
    const desiredPPS = (viewportWidth * 0.9) / (durationTicks / TICKS_PER_SECOND);

    const nextZoom = pxPerSecondToZoom(desiredPPS);

    isInternalZoomUpdate = true;
    timelineStore.setTimelineZoomExact(nextZoom);
    commitAnchoredScrollLeft(0);
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
