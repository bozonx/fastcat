import { TICKS_PER_SECOND } from '~/utils/time';
import { onUnmounted, ref, type Ref, computed } from 'vue';
import { pxToDeltaUs, pickBestSnapCandidateUs, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { quantizeTimeUsToFrames } from '~/timeline/commands/utils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useEffectiveHotkeys } from '~/composables/editor/hotkeys/useEffectiveHotkeys';
import { DRAG_DEADZONE_PX } from '~/utils/mouse';
import { isCommandMatched } from '~/utils/hotkeys/runtime';

interface MarkerLike {
  id: string;
  timeUs: number;
  durationUs?: number;
}

interface MarkerDragState {
  timeUs: number;
  durationUs?: number;
}

interface UseTimelineRulerMarkerDragOptions {
  markers: Ref<MarkerLike[]>;
  zoom: Ref<number>;
  fps: Ref<number>;
  selectMarker: (markerId: string, e?: MouseEvent) => void;
  updateMarker: (markerId: string, patch: { timeUs?: number; durationUs?: number }) => void;
  getSelectedMarkerIds: () => string[];
  computeSnapTargets?: (excludeMarkerId?: string) => number[];
  snapThresholdPx?: Ref<number>;
  isSnappingEnabled?: Ref<boolean>;
  scrollLeft: Ref<number>;
  getTimeUsFromPointerEvent: (event: PointerEvent) => number;
}

export function useTimelineRulerMarkerDrag(options: UseTimelineRulerMarkerDragOptions) {
  const draggedMarkerId = ref<string | null>(null);
  const draggedMarkerIds = ref<string[]>([]);
  const draggedMarkerPart = ref<'left' | 'right' | 'move'>('left');
  const hasDragged = ref(false);
  const markerDragStartX = ref(0);
  const markerDragStartY = ref(0);
  const markerDragStartScrollLeft = ref(0);
  const markerDragStartMouseTimeUs = ref(0);
  const markerDragStartStates = ref<Record<string, MarkerDragState>>({});
  const draggedMarkerPatches = ref<Record<string, { timeUs?: number; durationUs?: number }>>({});
  const suppressNextRulerClick = ref(false);
  const workspaceStore = useWorkspaceStore();

  const { hotkeyLookup, defaultHotkeyLookup } = useEffectiveHotkeys();

  const displayMarkers = computed(() => {
    const raw = options.markers.value;
    const patches = draggedMarkerPatches.value;
    const ids = draggedMarkerIds.value;
    if (ids.length === 0 || Object.keys(patches).length === 0) return raw;

    return raw.map((m) => {
      const patch = patches[m.id];
      if (!patch) return m;
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
      window.removeEventListener('pointercancel', activeMarkerPointerUp);
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
    if (draggedMarkerIds.value.length === 0) return;

    if (!hasDragged.value) {
      const dx = Math.abs(event.clientX - markerDragStartX.value);
      const dy = Math.abs(event.clientY - markerDragStartY.value);
      if (dx > DRAG_DEADZONE_PX || dy > DRAG_DEADZONE_PX) {
        hasDragged.value = true;
        suppressNextRulerClick.value = true;
      }
    }

    const dxPx =
      event.clientX -
      markerDragStartX.value +
      (options.scrollLeft.value - markerDragStartScrollLeft.value);
    const currentZoom = options.zoom.value;
    const deltaUs = pxToDeltaUs(dxPx, currentZoom);

    const patches: Record<string, { timeUs?: number; durationUs?: number }> = {};
    const leadId = draggedMarkerId.value;
    const leadState = leadId ? markerDragStartStates.value[leadId] : undefined;

    for (const markerId of draggedMarkerIds.value) {
      const startState = markerDragStartStates.value[markerId];
      if (!startState) continue;

      // Only the lead marker respects its resize part ('left'/'right'); all others move as a whole.
      const isLead = markerId === leadId;
      const part = isLead ? draggedMarkerPart.value : 'move';
      const isResizing = part === 'right';
      const isMovingWhole = part === 'move';

      if (isResizing && leadState && leadState.durationUs !== undefined) {
        let newDurationUs = Math.max(1, quantize(leadState.durationUs + deltaUs));

        if (getIsSnappingEnabled() && options.computeSnapTargets && options.snapThresholdPx) {
          const endUs = leadState.timeUs + newDurationUs;
          const thresholdUs = Math.round(
            (options.snapThresholdPx.value / zoomToPxPerSecond(currentZoom)) * TICKS_PER_SECOND,
          );
          const targets = options.computeSnapTargets(leadId ?? undefined);
          const snap = pickBestSnapCandidateUs({ rawUs: endUs, thresholdUs, targetsUs: targets });
          if (snap.distUs < thresholdUs) {
            newDurationUs = Math.max(1, quantize(snap.snappedUs) - leadState.timeUs);
          }
        }

        patches[markerId] = { durationUs: newDurationUs };
      } else {
        let newUs = Math.max(0, quantize(startState.timeUs + deltaUs));

        if (
          isLead &&
          getIsSnappingEnabled() &&
          options.computeSnapTargets &&
          options.snapThresholdPx
        ) {
          const thresholdUs = Math.round(
            (options.snapThresholdPx.value / zoomToPxPerSecond(currentZoom)) * TICKS_PER_SECOND,
          );
          const targets = options.computeSnapTargets(leadId ?? undefined);
          const snap = pickBestSnapCandidateUs({ rawUs: newUs, thresholdUs, targetsUs: targets });
          if (snap.distUs < thresholdUs) {
            newUs = Math.max(0, quantize(snap.snappedUs));
          }
        }

        if (startState.durationUs !== undefined && isMovingWhole) {
          // Move the whole zone, preserving its duration.
          patches[markerId] = {
            timeUs: newUs,
            durationUs: startState.durationUs,
          };
        } else if (startState.durationUs !== undefined) {
          // Left-edge resize: move the start while keeping the end fixed.
          const endUs = startState.timeUs + startState.durationUs;
          if (newUs < endUs) {
            patches[markerId] = {
              timeUs: newUs,
              durationUs: endUs - newUs,
            };
          } else {
            // Prevent collapsing zone by keeping minimal duration
            patches[markerId] = {
              timeUs: Math.max(0, endUs - 1),
              durationUs: 1,
            };
          }
        } else {
          patches[markerId] = { timeUs: newUs };
        }
      }
    }

    draggedMarkerPatches.value = patches;
  }

  function resetSuppressNextRulerClick() {
    window.setTimeout(() => {
      suppressNextRulerClick.value = false;
    }, 0);
  }

  function onWindowPointerUp() {
    const patches = draggedMarkerPatches.value;
    const ids = draggedMarkerIds.value;
    if (ids.length > 0 && Object.keys(patches).length > 0) {
      for (const markerId of ids) {
        const patch = patches[markerId];
        if (!patch) continue;

        const marker = options.markers.value.find((item) => item.id === markerId);
        const nextTimeUs = patch.timeUs ?? marker?.timeUs;
        const nextDurationUs = patch.durationUs ?? marker?.durationUs;
        const hasChanged = nextTimeUs !== marker?.timeUs || nextDurationUs !== marker?.durationUs;

        if (marker && hasChanged) {
          options.updateMarker(markerId, patch);
        }
      }
    }
    draggedMarkerId.value = null;
    draggedMarkerIds.value = [];
    draggedMarkerPatches.value = {};
    clearMarkerPointerListeners();
    resetSuppressNextRulerClick();
  }

  function onWindowKeyDown(event: KeyboardEvent) {
    const isCancel = isCommandMatched({
      event,
      cmdId: 'general.deselect',
      userSettings: workspaceStore.userSettings,
      hotkeyLookup: hotkeyLookup.value,
      defaultHotkeyLookup: defaultHotkeyLookup.value,
    });

    if (isCancel && draggedMarkerIds.value.length > 0) {
      event.preventDefault();
      draggedMarkerId.value = null;
      draggedMarkerIds.value = [];
      draggedMarkerPatches.value = {};
      clearMarkerPointerListeners();
    }
  }

  function onMarkerPointerDown(
    event: PointerEvent,
    markerId: string,
    part: 'left' | 'right' | 'move' = 'left',
  ) {
    if (event.button !== 0) return;

    event.stopPropagation();

    if (event.pointerId !== undefined && event.target && 'setPointerCapture' in event.target) {
      try {
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // Capture can fail if the pointer was already released; harmless.
      }
    }

    options.selectMarker(markerId, event);

    let selectedIds = options.getSelectedMarkerIds();
    if (!selectedIds.includes(markerId)) {
      selectedIds = [markerId];
    }

    const states: Record<string, MarkerDragState> = {};
    for (const id of selectedIds) {
      const m = options.markers.value.find((item) => item.id === id);
      if (m) {
        states[id] = {
          timeUs: quantize(m.timeUs),
          durationUs: m.durationUs !== undefined ? quantize(m.durationUs) : undefined,
        };
      }
    }

    draggedMarkerId.value = markerId;
    draggedMarkerIds.value = selectedIds;
    draggedMarkerPart.value = part;
    hasDragged.value = false;
    markerDragStartX.value = event.clientX;
    markerDragStartY.value = event.clientY;
    markerDragStartScrollLeft.value = options.scrollLeft.value;
    markerDragStartMouseTimeUs.value = options.getTimeUsFromPointerEvent(event);
    markerDragStartStates.value = states;
    draggedMarkerPatches.value = {};

    clearMarkerPointerListeners();
    activeMarkerPointerMove = onWindowPointerMove;
    activeMarkerPointerUp = () => onWindowPointerUp();
    activeMarkerKeyDown = onWindowKeyDown;
    window.addEventListener('pointermove', activeMarkerPointerMove);
    window.addEventListener('pointerup', activeMarkerPointerUp);
    window.addEventListener('pointercancel', activeMarkerPointerUp);
    window.addEventListener('keydown', activeMarkerKeyDown);
  }

  onUnmounted(() => {
    clearMarkerPointerListeners();
  });

  return {
    clearMarkerPointerListeners,
    draggedMarkerId,
    draggedMarkerIds,
    hasDragged,
    onMarkerPointerDown,
    displayMarkers,
    suppressNextRulerClick,
  };
}
