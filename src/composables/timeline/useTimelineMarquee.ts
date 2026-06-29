import { ref, computed, type Ref } from 'vue';
import { onBeforeUnmount } from 'vue';
import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { isTimelinePerfEnabled, sampleTimeline, flushTimelineSamples } from '~/utils/timeline/perf';

export function useTimelineMarquee(
  containerRef: Ref<HTMLElement | null>,
  tracks: Ref<TimelineTrack[]>,
  trackHeights: Ref<Record<string, number>>,
) {
  const timelineStore = useTimelineStore();
  const selectionStore = useSelectionStore();
  const projectStore = useProjectStore();

  const isMarqueeSelecting = ref(false);
  const marqueeStart = ref({ x: 0, y: 0 });
  const marqueeCurrent = ref({ x: 0, y: 0 });
  let activePointerMove: ((event: PointerEvent) => void) | null = null;
  let activePointerUp: ((event: PointerEvent) => void) | null = null;

  // Pointermove fires several times per frame; the live hit-test is O(all clips).
  // Coalesce to at most one selection pass per animation frame, and skip the
  // store writes entirely when the resulting clip set is unchanged (dragging
  // within the same clips) so we don't churn reactivity / re-render every frame.
  let marqueeRafId: number | null = null;
  let lastSelectionKey = '';

  const DEFAULT_TRACK_HEIGHT = 40;

  function cancelMarqueeRaf() {
    if (marqueeRafId !== null) {
      cancelAnimationFrame(marqueeRafId);
      marqueeRafId = null;
    }
  }

  function scheduleMarqueeUpdate() {
    if (marqueeRafId !== null) return;
    marqueeRafId = requestAnimationFrame(() => {
      marqueeRafId = null;
      updateLiveMarqueeSelection();
    });
  }

  function clearMarqueePointerListeners() {
    if (activePointerMove) {
      window.removeEventListener('pointermove', activePointerMove);
      activePointerMove = null;
    }

    if (activePointerUp) {
      window.removeEventListener('pointerup', activePointerUp);
      activePointerUp = null;
    }
  }

  const marqueeStyle = computed(() => {
    if (!isMarqueeSelecting.value) return {};
    const left = Math.min(marqueeStart.value.x, marqueeCurrent.value.x);
    const top = Math.min(marqueeStart.value.y, marqueeCurrent.value.y);
    const width = Math.abs(marqueeCurrent.value.x - marqueeStart.value.x);
    const height = Math.abs(marqueeCurrent.value.y - marqueeStart.value.y);
    return {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    };
  });

  function getPointerCoords(e: PointerEvent) {
    if (!containerRef.value) return { x: 0, y: 0 };
    const rect = containerRef.value.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function updateLiveMarqueeSelection() {
    if (!isMarqueeSelecting.value) return;

    const perfStart = isTimelinePerfEnabled() ? performance.now() : 0;

    const left = Math.min(marqueeStart.value.x, marqueeCurrent.value.x);
    const right = Math.max(marqueeStart.value.x, marqueeCurrent.value.x);
    const top = Math.min(marqueeStart.value.y, marqueeCurrent.value.y);
    const bottom = Math.max(marqueeStart.value.y, marqueeCurrent.value.y);

    const zoom = timelineStore.timelineZoom;
    const selectedItems: { trackId: string; itemId: string }[] = [];

    let currentY = 0;
    for (const track of tracks.value) {
      const trackHeight = trackHeights.value[track.id] ?? DEFAULT_TRACK_HEIGHT;
      const trackTop = currentY;
      const trackBottom = currentY + trackHeight;

      if (trackTop <= bottom && trackBottom >= top) {
        if (track.locked) continue;
        for (const item of track.items) {
          if (item.kind !== 'clip' || (item as { locked?: boolean }).locked) continue;
          const startPx = timeUsToPx(item.timelineRange.startUs, zoom);
          const endPx = timeUsToPx(
            item.timelineRange.startUs + item.timelineRange.durationUs,
            zoom,
          );
          if (startPx <= right && endPx >= left) {
            selectedItems.push({ trackId: track.id, itemId: item.id });
          }
        }
      }
      currentY += trackHeight;
    }

    // Dedup: the hit-test above is unavoidable per frame, but the store writes
    // (and the reactivity/re-render they trigger) only need to run when the
    // selected set actually changed. `selectedItems` is built in a deterministic
    // track/item order, so a plain join is a stable identity key.
    const selectionKey = selectedItems.map((i) => `${i.trackId}:${i.itemId}`).join('|');
    if (selectionKey === lastSelectionKey) {
      if (perfStart) sampleTimeline('marquee.updateLiveSelection', performance.now() - perfStart);
      return;
    }
    lastSelectionKey = selectionKey;

    if (selectedItems.length > 0) {
      timelineStore.selectTimelineItems(selectedItems.map((i) => i.itemId));
      const canOpen = projectStore.currentView === 'cut' || projectStore.currentView === 'sound';
      if (canOpen) selectionStore.selectTimelineItems(selectedItems);
      else selectionStore.clearSelection();
    } else {
      timelineStore.clearSelection();
      selectionStore.clearSelection();
    }

    if (perfStart) sampleTimeline('marquee.updateLiveSelection', performance.now() - perfStart);
  }

  function startMarquee(e: PointerEvent, onClick?: () => void) {
    e.preventDefault();
    const coords = getPointerCoords(e);
    marqueeStart.value = coords;
    marqueeCurrent.value = coords;
    let didMove = false;

    try {
      containerRef.value?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    const onMove = (ev: PointerEvent) => {
      const cur = getPointerCoords(ev);

      if (
        !didMove &&
        (Math.abs(cur.x - marqueeStart.value.x) > 3 || Math.abs(cur.y - marqueeStart.value.y) > 3)
      ) {
        didMove = true;
        isMarqueeSelecting.value = true;
        lastSelectionKey = '';
        timelineStore.clearSelection();
        selectionStore.clearSelection();
      }
      if (didMove) {
        marqueeCurrent.value = cur;
        scheduleMarqueeUpdate();
      }
    };

    const onUp = (ev: PointerEvent) => {
      cancelMarqueeRaf();
      if (didMove) {
        // Final synchronous pass for the released rectangle (a coalesced RAF may
        // still be pending), then end the marquee.
        updateLiveMarqueeSelection();
        isMarqueeSelecting.value = false;
        flushTimelineSamples('marquee.updateLiveSelection');
      } else if (onClick) {
        onClick();
      }
      try {
        containerRef.value?.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      clearMarqueePointerListeners();
    };

    clearMarqueePointerListeners();
    activePointerMove = onMove;
    activePointerUp = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  onBeforeUnmount(() => {
    cancelMarqueeRaf();
    clearMarqueePointerListeners();
    isMarqueeSelecting.value = false;
  });

  return {
    isMarqueeSelecting,
    marqueeStyle,
    startMarquee,
  };
}
