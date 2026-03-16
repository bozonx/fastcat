import { onUnmounted, ref, type Ref, computed } from 'vue';
import { pxToTimeUs, timeUsToPx } from '~/utils/timeline/geometry';
import { TIMELINE_RULER_CONSTANTS } from '~/utils/constants';

interface MarkerLike {
  id: string;
  timeUs: number;
  durationUs?: number;
}

interface UseTimelineRulerMarkerDragOptions {
  markers: Ref<MarkerLike[]>;
  zoom: Ref<number>;
  selectMarker: (markerId: string) => void;
  updateMarker: (markerId: string, patch: { timeUs?: number; durationUs?: number }) => void;
}

export function useTimelineRulerMarkerDrag(options: UseTimelineRulerMarkerDragOptions) {
  const draggedMarkerId = ref<string | null>(null);
  const draggedMarkerPart = ref<'left' | 'right'>('left');
  const markerDragStartX = ref(0);
  const markerDragStartUs = ref(0);
  const markerDragStartDurationUs = ref(0);
  const draggedMarkerPatch = ref<{ timeUs?: number; durationUs?: number } | null>(null);

  const displayMarkers = computed(() => {
    const raw = options.markers.value;
    if (!draggedMarkerId.value || !draggedMarkerPatch.value) return raw;

    const dragId = draggedMarkerId.value;
    const patch = draggedMarkerPatch.value;

    return raw.map((m) => {
      if (m.id !== dragId) return m;
      return {
        ...m,
        timeUs: patch.timeUs ?? m.timeUs,
        durationUs: patch.durationUs ?? m.durationUs,
      };
    });
  });

  let activeMarkerPointerMove: ((event: PointerEvent) => void) | null = null;
  let activeMarkerPointerUp: ((event: PointerEvent) => void) | null = null;

  function clearMarkerPointerListeners() {
    if (activeMarkerPointerMove) {
      window.removeEventListener('pointermove', activeMarkerPointerMove);
      activeMarkerPointerMove = null;
    }

    if (activeMarkerPointerUp) {
      window.removeEventListener('pointerup', activeMarkerPointerUp);
      activeMarkerPointerUp = null;
    }
  }

  function onWindowPointerMove(event: PointerEvent) {
    if (!draggedMarkerId.value) return;

    const dx = event.clientX - markerDragStartX.value;
    const currentZoom = options.zoom.value;

    if (draggedMarkerPart.value === 'left') {
      const startPx = timeUsToPx(markerDragStartUs.value, currentZoom);
      const newPx = Math.max(0, startPx + dx);
      const newUs = Math.max(0, pxToTimeUs(newPx, currentZoom));
      const marker = options.markers.value.find((item) => item.id === draggedMarkerId.value);

      if (marker && marker.durationUs !== undefined) {
        const endUs = markerDragStartUs.value + markerDragStartDurationUs.value;
        if (newUs < endUs) {
          draggedMarkerPatch.value = {
            timeUs: newUs,
            durationUs: endUs - newUs,
          };
        }
        return;
      }

      draggedMarkerPatch.value = { timeUs: newUs };
      return;
    }

    const durationPx = timeUsToPx(markerDragStartDurationUs.value, currentZoom);
    const newDurationPx = Math.max(
      TIMELINE_RULER_CONSTANTS.MIN_MARKER_DURATION_PX,
      durationPx + dx,
    );
    const newDurationUs = pxToTimeUs(newDurationPx, currentZoom);

    draggedMarkerPatch.value = { durationUs: newDurationUs };
  }

  function onWindowPointerUp() {
    if (draggedMarkerId.value && draggedMarkerPatch.value) {
      options.updateMarker(draggedMarkerId.value, draggedMarkerPatch.value);
    }
    draggedMarkerId.value = null;
    draggedMarkerPatch.value = null;
    clearMarkerPointerListeners();
  }

  function onMarkerPointerDown(
    event: PointerEvent,
    markerId: string,
    part: 'left' | 'right' = 'left',
  ) {
    if (event.button !== 0) return;

    event.stopPropagation();
    options.selectMarker(markerId);

    const marker = options.markers.value.find((item) => item.id === markerId);
    if (!marker) return;

    draggedMarkerId.value = markerId;
    draggedMarkerPart.value = part;
    markerDragStartX.value = event.clientX;
    markerDragStartUs.value = marker.timeUs;
    markerDragStartDurationUs.value = marker.durationUs ?? 0;
    draggedMarkerPatch.value = null;

    clearMarkerPointerListeners();
    activeMarkerPointerMove = onWindowPointerMove;
    activeMarkerPointerUp = () => onWindowPointerUp();
    window.addEventListener('pointermove', activeMarkerPointerMove);
    window.addEventListener('pointerup', activeMarkerPointerUp);
  }

  onUnmounted(() => {
    clearMarkerPointerListeners();
  });

  return {
    clearMarkerPointerListeners,
    onMarkerPointerDown,
    displayMarkers,
  };
}
