import { onUnmounted, ref, type Ref, computed } from 'vue';
import {
  pxToTimeUs,
  timeUsToPx,
  pickBestSnapCandidateUs,
  zoomToPxPerSecond,
} from '~/utils/timeline/geometry';
import { TIMELINE_RULER_CONSTANTS } from '~/utils/constants';
import { quantizeTimeUsToFrames } from '~/timeline/commands/utils';

interface MarkerLike {
  id: string;
  timeUs: number;
  durationUs?: number;
}

interface UseTimelineRulerMarkerDragOptions {
  markers: Ref<MarkerLike[]>;
  zoom: Ref<number>;
  fps: Ref<number>;
  selectMarker: (markerId: string) => void;
  updateMarker: (markerId: string, patch: { timeUs?: number; durationUs?: number }) => void;
  computeSnapTargets?: () => number[];
  snapThresholdPx?: Ref<number>;
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

  function quantize(timeUs: number) {
    return quantizeTimeUsToFrames(timeUs, options.fps.value, 'round');
  }

  function onWindowPointerMove(event: PointerEvent) {
    if (!draggedMarkerId.value) return;

    const dx = event.clientX - markerDragStartX.value;
    const currentZoom = options.zoom.value;

    if (draggedMarkerPart.value === 'left') {
      const startPx = timeUsToPx(markerDragStartUs.value, currentZoom);
      const newPx = Math.max(0, startPx + dx);
      let newUs = Math.max(0, quantize(pxToTimeUs(newPx, currentZoom)));
      const marker = options.markers.value.find((item) => item.id === draggedMarkerId.value);

      if (options.computeSnapTargets && options.snapThresholdPx) {
        const thresholdUs = Math.round(
          (options.snapThresholdPx.value / zoomToPxPerSecond(currentZoom)) * 1e6,
        );
        const targets = options.computeSnapTargets();
        const snap = pickBestSnapCandidateUs({ rawUs: newUs, thresholdUs, targetsUs: targets });
        if (snap.distUs < thresholdUs) {
          newUs = Math.max(0, snap.snappedUs);
        }
      }

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
    let newDurationUs = Math.max(1, quantize(pxToTimeUs(newDurationPx, currentZoom)));

    if (options.computeSnapTargets && options.snapThresholdPx) {
      const endUs = markerDragStartUs.value + newDurationUs;
      const thresholdUs = Math.round(
        (options.snapThresholdPx.value / zoomToPxPerSecond(currentZoom)) * 1e6,
      );
      const targets = options.computeSnapTargets();
      const snap = pickBestSnapCandidateUs({ rawUs: endUs, thresholdUs, targetsUs: targets });
      if (snap.distUs < thresholdUs) {
        newDurationUs = Math.max(1, snap.snappedUs - markerDragStartUs.value);
      }
    }

    draggedMarkerPatch.value = { durationUs: newDurationUs };
  }

  function onWindowPointerUp() {
    if (draggedMarkerId.value && draggedMarkerPatch.value) {
      const marker = options.markers.value.find((item) => item.id === draggedMarkerId.value);
      const nextTimeUs = draggedMarkerPatch.value.timeUs ?? marker?.timeUs;
      const nextDurationUs = draggedMarkerPatch.value.durationUs ?? marker?.durationUs;
      const hasChanged = nextTimeUs !== marker?.timeUs || nextDurationUs !== marker?.durationUs;

      if (marker && hasChanged) {
        options.updateMarker(draggedMarkerId.value, draggedMarkerPatch.value);
      }
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
    draggedMarkerId,
    onMarkerPointerDown,
    displayMarkers,
  };
}
