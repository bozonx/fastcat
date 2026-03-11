import { ref, computed, type Ref } from 'vue';
import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { timeUsToPx } from '~/utils/timeline/geometry';

export function useTimelineMarquee(containerRef: Ref<HTMLElement | null>, tracks: Ref<TimelineTrack[]>, trackHeights: Ref<Record<string, number>>) {
  const timelineStore = useTimelineStore();
  const selectionStore = useSelectionStore();
  const projectStore = useProjectStore();

  const isMarqueeSelecting = ref(false);
  const marqueeStart = ref({ x: 0, y: 0 });
  const marqueeCurrent = ref({ x: 0, y: 0 });

  const DEFAULT_TRACK_HEIGHT = 40;

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

      if (trackTop >= top && trackBottom <= bottom) {
        for (const item of track.items) {
          if (item.kind !== 'clip' || (item as any).locked) continue;
          const startPx = timeUsToPx(item.timelineRange.startUs, zoom);
          const endPx = timeUsToPx(item.timelineRange.startUs + item.timelineRange.durationUs, zoom);
          if (startPx >= left && endPx <= right) {
            selectedItems.push({ trackId: track.id, itemId: item.id });
          }
        }
      }
      currentY += trackHeight;
    }

    if (selectedItems.length > 0) {
      timelineStore.selectTimelineItems(selectedItems.map(i => i.itemId));
      const canOpen = projectStore.currentView === 'cut' || projectStore.currentView === 'sound';
      if (canOpen) selectionStore.selectTimelineItems(selectedItems);
      else selectionStore.clearSelection();
    } else {
      timelineStore.clearSelection();
      selectionStore.clearSelection();
    }
  }

  function startMarquee(e: PointerEvent, onClick?: () => void) {
    if (e.button !== 0) return;
    const coords = getPointerCoords(e);
    marqueeStart.value = coords;
    marqueeCurrent.value = coords;
    let didMove = false;

    try {
      containerRef.value?.setPointerCapture(e.pointerId);
    } catch { /* ignore */ }

    const onMove = (ev: PointerEvent) => {
      const cur = getPointerCoords(ev);
      if (!didMove && (Math.abs(cur.x - marqueeStart.value.x) > 3 || Math.abs(cur.y - marqueeStart.value.y) > 3)) {
        didMove = true;
        isMarqueeSelecting.value = true;
        timelineStore.clearSelection();
        selectionStore.clearSelection();
      }
      if (didMove) {
        marqueeCurrent.value = cur;
        updateLiveMarqueeSelection();
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (didMove) {
        isMarqueeSelecting.value = false;
        updateLiveMarqueeSelection();
      } else if (onClick) {
        onClick();
      }
      try { containerRef.value?.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return {
    isMarqueeSelecting,
    marqueeStyle,
    startMarquee
  };
}
