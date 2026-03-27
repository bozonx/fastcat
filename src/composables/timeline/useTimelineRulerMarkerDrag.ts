import { onUnmounted, ref, type Ref, computed } from 'vue';
import {
  pxToTimeUs,
  pxToDeltaUs,
  timeUsToPx,
  pickBestSnapCandidateUs,
  zoomToPxPerSecond,
} from '~/utils/timeline/geometry';
import { TIMELINE_RULER_CONSTANTS } from '~/utils/constants';
import { quantizeTimeUsToFrames } from '~/timeline/commands/utils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  createDefaultHotkeyLookup,
  createHotkeyLookup,
  isCommandMatched,
} from '~/utils/hotkeys/runtime';

interface MarkerLike {
  id: string;
  timeUs: number;
  durationUs?: number;
}

interface UseTimelineRulerMarkerDragOptions {
  markers: Ref<MarkerLike[]>;
  zoom: Ref<number>;
  fps: Ref<number>;
  selectMarker: (
    markerId: string,
    e?: MouseEvent,
    part?: 'left' | 'right',
    movePlayhead?: boolean,
  ) => void;
  updateMarker: (markerId: string, patch: { timeUs?: number; durationUs?: number }) => void;
  computeSnapTargets?: () => number[];
  snapThresholdPx?: Ref<number>;
  isSnappingEnabled?: Ref<boolean>;
  scrollLeft: Ref<number>;
  getTimeUsFromPointerEvent: (event: PointerEvent) => number;
}

export function useTimelineRulerMarkerDrag(options: UseTimelineRulerMarkerDragOptions) {
  const draggedMarkerId = ref<string | null>(null);
  const draggedMarkerPart = ref<'left' | 'right'>('left');
  const markerDragStartX = ref(0);
  const markerDragStartScrollLeft = ref(0);
  const markerDragStartMouseTimeUs = ref(0);
  const markerDragStartUs = ref(0);
  const markerDragStartDurationUs = ref(0);
  const draggedMarkerPatch = ref<{ timeUs?: number; durationUs?: number } | null>(null);
  const workspaceStore = useWorkspaceStore();

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
  const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));

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
  let activeMarkerKeyDown: ((event: KeyboardEvent) => void) | null = null;

  function clearMarkerPointerListeners() {
    if (activeMarkerPointerMove) {
      window.removeEventListener('pointermove', activeMarkerPointerMove);
      activeMarkerPointerMove = null;
    }

    if (activeMarkerPointerUp) {
      window.removeEventListener('pointerup', activeMarkerPointerUp);
      activeMarkerPointerUp = null;
    }

    if (activeMarkerKeyDown) {
      window.removeEventListener('keydown', activeMarkerKeyDown);
      activeMarkerKeyDown = null;
    }
  }

  function quantize(timeUs: number) {
    return quantizeTimeUsToFrames(timeUs, options.fps.value, 'round');
  }

  function getIsSnappingEnabled() {
    return options.isSnappingEnabled?.value ?? true;
  }

  function onWindowPointerMove(event: PointerEvent) {
    if (!draggedMarkerId.value) return;

    const dxPx =
      event.clientX -
      markerDragStartX.value +
      (options.scrollLeft.value - markerDragStartScrollLeft.value);
    const currentZoom = options.zoom.value;
    const deltaUs = pxToDeltaUs(dxPx, currentZoom);

    if (draggedMarkerPart.value === 'left') {
      let newUs = Math.max(0, quantize(markerDragStartUs.value + deltaUs));
      const marker = options.markers.value.find((item) => item.id === draggedMarkerId.value);

      if (getIsSnappingEnabled() && options.computeSnapTargets && options.snapThresholdPx) {
        const thresholdUs = Math.round(
          (options.snapThresholdPx.value / zoomToPxPerSecond(currentZoom)) * 1e6,
        );
        const targets = options.computeSnapTargets();
        const snap = pickBestSnapCandidateUs({ rawUs: newUs, thresholdUs, targetsUs: targets });
        if (snap.distUs < thresholdUs) {
          newUs = Math.max(0, quantize(snap.snappedUs));
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

    let newDurationUs = Math.max(1, quantize(markerDragStartDurationUs.value + deltaUs));

    if (getIsSnappingEnabled() && options.computeSnapTargets && options.snapThresholdPx) {
      const endUs = markerDragStartUs.value + newDurationUs;
      const thresholdUs = Math.round(
        (options.snapThresholdPx.value / zoomToPxPerSecond(currentZoom)) * 1e6,
      );
      const targets = options.computeSnapTargets();
      const snap = pickBestSnapCandidateUs({ rawUs: endUs, thresholdUs, targetsUs: targets });
      if (snap.distUs < thresholdUs) {
        newDurationUs = Math.max(1, quantize(snap.snappedUs) - markerDragStartUs.value);
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

  function onWindowKeyDown(event: KeyboardEvent) {
    const isCancel = isCommandMatched({
      event,
      cmdId: 'general.deselect',
      userSettings: workspaceStore.userSettings,
      hotkeyLookup: hotkeyLookup.value,
      defaultHotkeyLookup: defaultHotkeyLookup.value,
    });

    if (isCancel && draggedMarkerId.value) {
      event.preventDefault();
      draggedMarkerId.value = null;
      draggedMarkerPatch.value = null;
      clearMarkerPointerListeners();
    }
  }

  function onMarkerPointerDown(
    event: PointerEvent,
    markerId: string,
    part: 'left' | 'right' = 'left',
  ) {
    if (event.button !== 0) return;

    event.stopPropagation();
    // Select marker but do not move playhead so it doesn't snap to playhead immediately
    options.selectMarker(markerId, undefined, part, false);

    const marker = options.markers.value.find((item) => item.id === markerId);
    if (!marker) return;

    draggedMarkerId.value = markerId;
    draggedMarkerPart.value = part;
    markerDragStartX.value = event.clientX;
    markerDragStartScrollLeft.value = options.scrollLeft.value;
    markerDragStartMouseTimeUs.value = options.getTimeUsFromPointerEvent(event);
    markerDragStartUs.value = quantize(marker.timeUs);
    markerDragStartDurationUs.value = quantize(marker.durationUs ?? 0);
    draggedMarkerPatch.value = null;

    clearMarkerPointerListeners();
    activeMarkerPointerMove = onWindowPointerMove;
    activeMarkerPointerUp = () => onWindowPointerUp();
    activeMarkerKeyDown = onWindowKeyDown;
    window.addEventListener('pointermove', activeMarkerPointerMove);
    window.addEventListener('pointerup', activeMarkerPointerUp);
    window.addEventListener('keydown', activeMarkerKeyDown);
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
