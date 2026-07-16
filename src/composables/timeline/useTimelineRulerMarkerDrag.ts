import { TICKS_PER_SECOND } from '~/utils/time';
import { onUnmounted, ref, type Ref, computed } from 'vue';
import {
  pxToDeltaTicks,
  pickBestSnapCandidateTicks,
  zoomToPxPerSecond,
} from '~/utils/timeline/geometry';
import { quantizeTicksToFrames } from '~/timeline/commands/utils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useEffectiveHotkeys } from '~/composables/editor/hotkeys/useEffectiveHotkeys';
import { DRAG_DEADZONE_PX } from '~/utils/mouse';
import { isCommandMatched } from '~/utils/hotkeys/runtime';

interface MarkerLike {
  id: string;
  timeTicks: number;
  durationTicks?: number;
}

interface MarkerDragState {
  timeTicks: number;
  durationTicks?: number;
}

interface UseTimelineRulerMarkerDragOptions {
  markers: Ref<MarkerLike[]>;
  zoom: Ref<number>;
  fps: Ref<number>;
  selectMarker: (markerId: string, e?: MouseEvent) => void;
  updateMarker: (markerId: string, patch: { timeTicks?: number; durationTicks?: number }) => void;
  getSelectedMarkerIds: () => string[];
  computeSnapTargets?: (excludeMarkerId?: string) => number[];
  snapThresholdPx?: Ref<number>;
  isSnappingEnabled?: Ref<boolean>;
  scrollLeft: Ref<number>;
  getTimeTicksFromPointerEvent: (event: PointerEvent) => number;
}

export function useTimelineRulerMarkerDrag(options: UseTimelineRulerMarkerDragOptions) {
  const draggedMarkerId = ref<string | null>(null);
  const draggedMarkerIds = ref<string[]>([]);
  const draggedMarkerPart = ref<'left' | 'right' | 'move'>('left');
  const hasDragged = ref(false);
  const markerDragStartX = ref(0);
  const markerDragStartY = ref(0);
  const markerDragStartScrollLeft = ref(0);
  const markerDragStartMouseTimeTicks = ref(0);
  const markerDragStartStates = ref<Record<string, MarkerDragState>>({});
  const draggedMarkerPatches = ref<Record<string, { timeTicks?: number; durationTicks?: number }>>(
    {},
  );
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
        timeTicks: patch.timeTicks ?? m.timeTicks,
        durationTicks: patch.durationTicks ?? m.durationTicks,
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

  function quantize(timeTicks: number) {
    return quantizeTicksToFrames(timeTicks, options.fps.value, 'round');
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
    const deltaTicks = pxToDeltaTicks(dxPx, currentZoom);

    const patches: Record<string, { timeTicks?: number; durationTicks?: number }> = {};
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

      if (isResizing && leadState && leadState.durationTicks !== undefined) {
        let newDurationTicks = Math.max(1, quantize(leadState.durationTicks + deltaTicks));

        if (getIsSnappingEnabled() && options.computeSnapTargets && options.snapThresholdPx) {
          const endTicks = leadState.timeTicks + newDurationTicks;
          const thresholdTicks = Math.round(
            (options.snapThresholdPx.value / zoomToPxPerSecond(currentZoom)) * TICKS_PER_SECOND,
          );
          const targets = options.computeSnapTargets(leadId ?? undefined);
          const snap = pickBestSnapCandidateTicks({
            rawTicks: endTicks,
            thresholdTicks,
            targetsTicks: targets,
          });
          if (snap.distTicks < thresholdTicks) {
            newDurationTicks = Math.max(1, quantize(snap.snappedTicks) - leadState.timeTicks);
          }
        }

        patches[markerId] = { durationTicks: newDurationTicks };
      } else {
        let newTicks = Math.max(0, quantize(startState.timeTicks + deltaTicks));

        if (
          isLead &&
          getIsSnappingEnabled() &&
          options.computeSnapTargets &&
          options.snapThresholdPx
        ) {
          const thresholdTicks = Math.round(
            (options.snapThresholdPx.value / zoomToPxPerSecond(currentZoom)) * TICKS_PER_SECOND,
          );
          const targets = options.computeSnapTargets(leadId ?? undefined);
          const snap = pickBestSnapCandidateTicks({
            rawTicks: newTicks,
            thresholdTicks,
            targetsTicks: targets,
          });
          if (snap.distTicks < thresholdTicks) {
            newTicks = Math.max(0, quantize(snap.snappedTicks));
          }
        }

        if (startState.durationTicks !== undefined && isMovingWhole) {
          // Move the whole zone, preserving its duration.
          patches[markerId] = {
            timeTicks: newTicks,
            durationTicks: startState.durationTicks,
          };
        } else if (startState.durationTicks !== undefined) {
          // Left-edge resize: move the start while keeping the end fixed.
          const endTicks = startState.timeTicks + startState.durationTicks;
          if (newTicks < endTicks) {
            patches[markerId] = {
              timeTicks: newTicks,
              durationTicks: endTicks - newTicks,
            };
          } else {
            // Prevent collapsing zone by keeping minimal duration
            patches[markerId] = {
              timeTicks: Math.max(0, endTicks - 1),
              durationTicks: 1,
            };
          }
        } else {
          patches[markerId] = { timeTicks: newTicks };
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
        const nextTimeTicks = patch.timeTicks ?? marker?.timeTicks;
        const nextDurationTicks = patch.durationTicks ?? marker?.durationTicks;
        const hasChanged =
          nextTimeTicks !== marker?.timeTicks || nextDurationTicks !== marker?.durationTicks;

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
          timeTicks: quantize(m.timeTicks),
          durationTicks: m.durationTicks !== undefined ? quantize(m.durationTicks) : undefined,
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
    markerDragStartMouseTimeTicks.value = options.getTimeTicksFromPointerEvent(event);
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
