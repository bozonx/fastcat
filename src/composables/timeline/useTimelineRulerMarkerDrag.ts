import { onUnmounted, ref, type Ref } from 'vue';
import { pxToTimeUs, timeUsToPx } from '~/utils/timeline/geometry';

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
          options.updateMarker(draggedMarkerId.value, {
            timeUs: newUs,
            durationUs: endUs - newUs,
          });
        }
        return;
      }

      options.updateMarker(draggedMarkerId.value, { timeUs: newUs });
      return;
    }

    const durationPx = timeUsToPx(markerDragStartDurationUs.value, currentZoom);
    const newDurationPx = Math.max(10, durationPx + dx);
    const newDurationUs = pxToTimeUs(newDurationPx, currentZoom);

    options.updateMarker(draggedMarkerId.value, { durationUs: newDurationUs });
  }

  function onWindowPointerUp() {
    draggedMarkerId.value = null;
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
  };
}
