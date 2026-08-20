import { TICKS_PER_SECOND } from '~/utils/time';
import { onUnmounted, ref, type Ref, computed } from 'vue';
import {
  pxToTimeTicks,
  pickBestSnapCandidateTicks,
  zoomToPxPerSecond,
} from '~/utils/timeline/geometry';
import { TIMELINE_RULER_CONSTANTS } from '~/utils/constants';
import { quantizeTicksToFrames } from '~/timeline/commands/utils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useEffectiveHotkeys } from '~/composables/editor/hotkeys/useEffectiveHotkeys';
import { isCommandMatched } from '~/utils/hotkeys/runtime';

export type TimelineRulerSelectionDragPart = 'move' | 'left' | 'right';

interface SelectionRangeLike {
  startTicks: number;
  endTicks: number;
}

interface UseTimelineRulerSelectionDragOptions {
  selectionRange: Ref<SelectionRangeLike | null | undefined>;
  zoom: Ref<number>;
  fps: Ref<number>;
  scrollLeft: Ref<number>;
  getTimeTicksFromPointerEvent: (event: PointerEvent) => number;
  selectSelectionRange: () => void;
  updateSelectionRange: (payload: { startTicks: number; endTicks: number } | null) => void;
  createSelectionRange: (payload: { startTicks: number; endTicks: number }) => void;
  setPreviewSelectionRange?: (payload: { startTicks: number; endTicks: number } | null) => void;
  computeSnapTargets?: () => number[];
  snapThresholdPx?: Ref<number> | number;
  isSnappingEnabled?: Ref<boolean>;
}

export function useTimelineRulerSelectionDrag(options: UseTimelineRulerSelectionDragOptions) {
  const isDraggingSelectionRange = ref(false);
  const selectionDragPart = ref<TimelineRulerSelectionDragPart>('move');
  const selectionDragStartX = ref(0);
  const selectionDragStartScrollLeft = ref(0);
  const selectionDragStartMouseTimeTicks = ref(0);
  const selectionDragStartStartTicks = ref(0);
  const selectionDragStartEndTicks = ref(0);
  const draggedSelectionPatch = ref<{ startTicks: number; endTicks: number } | null>(null);
  const workspaceStore = useWorkspaceStore();

  const { hotkeyLookup, defaultHotkeyLookup } = useEffectiveHotkeys();

  const suppressNextRulerClick = ref(false);
  const isCreatingSelectionRange = ref(false);
  const selectionCreateStartTicks = ref(0);

  const displaySelectionRange = computed(() => {
    if (isDraggingSelectionRange.value && draggedSelectionPatch.value) {
      return draggedSelectionPatch.value;
    }
    if (isCreatingSelectionRange.value && draggedSelectionPatch.value) {
      return draggedSelectionPatch.value;
    }
    return options.selectionRange.value;
  });

  let activeSelectionPointerMove: ((event: PointerEvent) => void) | null = null;
  let activeSelectionPointerUp: ((event: PointerEvent) => void) | null = null;
  let activeSelectionKeyDown: ((event: KeyboardEvent) => void) | null = null;

  function clearSelectionPointerListeners() {
    if (activeSelectionPointerMove) {
      window.removeEventListener('pointermove', activeSelectionPointerMove);
      activeSelectionPointerMove = null;
    }

    if (activeSelectionPointerUp) {
      window.removeEventListener('pointerup', activeSelectionPointerUp);
      window.removeEventListener('pointercancel', activeSelectionPointerUp);
      activeSelectionPointerUp = null;
    }

    if (activeSelectionKeyDown) {
      window.removeEventListener('keydown', activeSelectionKeyDown);
      activeSelectionKeyDown = null;
    }
  }

  function resetSuppressNextRulerClick() {
    window.setTimeout(() => {
      suppressNextRulerClick.value = false;
    }, 0);
  }

  function quantize(timeTicks: number) {
    return quantizeTicksToFrames(timeTicks, options.fps.value, 'round');
  }

  function getFrameDurationTicks() {
    return Math.max(1, Math.round(TICKS_PER_SECOND / options.fps.value));
  }

  function getSnapThresholdPx() {
    return typeof options.snapThresholdPx === 'number'
      ? options.snapThresholdPx
      : (options.snapThresholdPx?.value ?? 0);
  }

  function getIsSnappingEnabled() {
    return options.isSnappingEnabled?.value ?? true;
  }

  function updateSelectionRangeFromDrag(event: PointerEvent) {
    const range = options.selectionRange.value;
    if (!range) return;

    const dxPx =
      event.clientX -
      selectionDragStartX.value +
      (options.scrollLeft.value - selectionDragStartScrollLeft.value);
    const mouseDeltaTicks = Math.round(
      (dxPx / zoomToPxPerSecond(options.zoom.value)) * TICKS_PER_SECOND,
    );
    const minDurationTicks = Math.max(
      getFrameDurationTicks(),
      pxToTimeTicks(TIMELINE_RULER_CONSTANTS.MIN_SELECTION_DURATION_PX, options.zoom.value),
    );

    if (selectionDragPart.value === 'move') {
      const durationTicks = selectionDragStartEndTicks.value - selectionDragStartStartTicks.value;
      let nextStartTicks = Math.max(
        0,
        quantize(selectionDragStartStartTicks.value + mouseDeltaTicks),
      );
      let nextEndTicks = nextStartTicks + durationTicks;

      if (getIsSnappingEnabled() && options.computeSnapTargets && options.snapThresholdPx) {
        const thresholdTicks = Math.round(
          (getSnapThresholdPx() / zoomToPxPerSecond(options.zoom.value)) * TICKS_PER_SECOND,
        );
        const targets = options.computeSnapTargets();

        const snapStart = pickBestSnapCandidateTicks({
          rawTicks: nextStartTicks,
          thresholdTicks,
          targetsTicks: targets,
        });
        const snapEnd = pickBestSnapCandidateTicks({
          rawTicks: nextEndTicks,
          thresholdTicks,
          targetsTicks: targets,
        });

        if (snapStart.distTicks < thresholdTicks && snapStart.distTicks <= snapEnd.distTicks) {
          nextStartTicks = quantize(snapStart.snappedTicks);
        } else if (snapEnd.distTicks < thresholdTicks) {
          nextEndTicks = quantize(snapEnd.snappedTicks);
          nextStartTicks = Math.max(0, nextEndTicks - quantize(durationTicks));
        }
      }

      draggedSelectionPatch.value = {
        startTicks: nextStartTicks,
        endTicks: nextStartTicks + quantize(durationTicks),
      };
      if (options.setPreviewSelectionRange) {
        options.setPreviewSelectionRange(draggedSelectionPatch.value);
      }
      return;
    }

    if (selectionDragPart.value === 'left') {
      const maxStartTicks = selectionDragStartEndTicks.value - minDurationTicks;
      let nextStartTicks = Math.max(
        0,
        Math.min(maxStartTicks, quantize(selectionDragStartStartTicks.value + mouseDeltaTicks)),
      );

      if (getIsSnappingEnabled() && options.computeSnapTargets && options.snapThresholdPx) {
        const thresholdTicks = Math.round(
          (getSnapThresholdPx() / zoomToPxPerSecond(options.zoom.value)) * TICKS_PER_SECOND,
        );
        const targets = options.computeSnapTargets();
        const snap = pickBestSnapCandidateTicks({
          rawTicks: nextStartTicks,
          thresholdTicks,
          targetsTicks: targets,
        });
        if (snap.distTicks < thresholdTicks) {
          nextStartTicks = Math.max(0, Math.min(maxStartTicks, quantize(snap.snappedTicks)));
        }
      }

      draggedSelectionPatch.value = {
        startTicks: nextStartTicks,
        endTicks: selectionDragStartEndTicks.value,
      };
      if (options.setPreviewSelectionRange) {
        options.setPreviewSelectionRange(draggedSelectionPatch.value);
      }
      return;
    }

    let nextEndTicks = Math.max(
      selectionDragStartStartTicks.value + minDurationTicks,
      quantize(selectionDragStartEndTicks.value + mouseDeltaTicks),
    );

    if (getIsSnappingEnabled() && options.computeSnapTargets && options.snapThresholdPx) {
      const thresholdTicks = Math.round(
        (getSnapThresholdPx() / zoomToPxPerSecond(options.zoom.value)) * TICKS_PER_SECOND,
      );
      const targets = options.computeSnapTargets();
      const snap = pickBestSnapCandidateTicks({
        rawTicks: nextEndTicks,
        thresholdTicks,
        targetsTicks: targets,
      });
      if (snap.distTicks < thresholdTicks) {
        nextEndTicks = Math.max(
          selectionDragStartStartTicks.value + minDurationTicks,
          quantize(snap.snappedTicks),
        );
      }
    }

    draggedSelectionPatch.value = {
      startTicks: selectionDragStartStartTicks.value,
      endTicks: nextEndTicks,
    };
    if (options.setPreviewSelectionRange) {
      options.setPreviewSelectionRange(draggedSelectionPatch.value);
    }
  }

  function onSelectionPointerMove(event: PointerEvent) {
    if (!isDraggingSelectionRange.value) return;
    suppressNextRulerClick.value = true;
    updateSelectionRangeFromDrag(event);
  }

  function onSelectionPointerUp() {
    if (isDraggingSelectionRange.value && draggedSelectionPatch.value) {
      options.updateSelectionRange(draggedSelectionPatch.value);
    }

    isDraggingSelectionRange.value = false;
    draggedSelectionPatch.value = null;
    if (options.setPreviewSelectionRange) {
      options.setPreviewSelectionRange(null);
    }
    resetSuppressNextRulerClick();
    clearSelectionPointerListeners();
  }

  function onSelectionKeyDown(event: KeyboardEvent) {
    const isCancel = isCommandMatched({
      event,
      cmdId: 'general.deselect',
      userSettings: workspaceStore.userSettings,
      hotkeyLookup: hotkeyLookup.value,
      defaultHotkeyLookup: defaultHotkeyLookup.value,
    });

    if (isCancel && (isDraggingSelectionRange.value || isCreatingSelectionRange.value)) {
      event.preventDefault();
      isDraggingSelectionRange.value = false;
      isCreatingSelectionRange.value = false;
      draggedSelectionPatch.value = null;
      if (options.setPreviewSelectionRange) {
        options.setPreviewSelectionRange(null);
      }
      clearSelectionPointerListeners();
      resetSuppressNextRulerClick();
    }
  }

  function startSelectionRangeDrag(event: PointerEvent, part: TimelineRulerSelectionDragPart) {
    if (!options.selectionRange.value) return;

    event.stopPropagation();
    event.preventDefault();

    if (event.pointerId !== undefined && event.target && 'setPointerCapture' in event.target) {
      try {
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // Capture can fail if the pointer was already released; harmless.
      }
    }

    options.selectSelectionRange();
    isDraggingSelectionRange.value = true;
    selectionDragPart.value = part;
    selectionDragStartX.value = event.clientX;
    selectionDragStartScrollLeft.value = options.scrollLeft.value;
    selectionDragStartMouseTimeTicks.value = options.getTimeTicksFromPointerEvent(event);
    selectionDragStartStartTicks.value = quantize(options.selectionRange.value.startTicks);
    selectionDragStartEndTicks.value = quantize(options.selectionRange.value.endTicks);
    draggedSelectionPatch.value = null;
    suppressNextRulerClick.value = part !== 'move';

    clearSelectionPointerListeners();
    activeSelectionPointerMove = onSelectionPointerMove;
    activeSelectionPointerUp = () => onSelectionPointerUp();
    activeSelectionKeyDown = onSelectionKeyDown;
    window.addEventListener('pointermove', activeSelectionPointerMove);
    window.addEventListener('pointerup', activeSelectionPointerUp);
    window.addEventListener('pointercancel', activeSelectionPointerUp);
    window.addEventListener('keydown', activeSelectionKeyDown);
  }

  function onSelectionCreatePointerMove(event: PointerEvent) {
    if (!isCreatingSelectionRange.value) return;

    suppressNextRulerClick.value = true;
    let currentTicks = quantize(options.getTimeTicksFromPointerEvent(event));

    if (getIsSnappingEnabled() && options.computeSnapTargets && options.snapThresholdPx) {
      const thresholdTicks = Math.round(
        (getSnapThresholdPx() / zoomToPxPerSecond(options.zoom.value)) * TICKS_PER_SECOND,
      );
      const targets = options.computeSnapTargets();
      const snap = pickBestSnapCandidateTicks({
        rawTicks: currentTicks,
        thresholdTicks,
        targetsTicks: targets,
      });
      if (snap.distTicks < thresholdTicks) {
        currentTicks = snap.snappedTicks;
      }
    }

    const startTicks = Math.min(selectionCreateStartTicks.value, currentTicks);
    const endTicks = Math.max(selectionCreateStartTicks.value, currentTicks);

    draggedSelectionPatch.value = {
      startTicks,
      endTicks: Math.max(startTicks + getFrameDurationTicks(), endTicks),
    };

    if (options.setPreviewSelectionRange) {
      options.setPreviewSelectionRange(draggedSelectionPatch.value);
    }
  }

  function onSelectionCreatePointerUp() {
    if (isCreatingSelectionRange.value && draggedSelectionPatch.value) {
      options.createSelectionRange(draggedSelectionPatch.value);
    } else {
      options.updateSelectionRange(null);
    }

    isCreatingSelectionRange.value = false;
    draggedSelectionPatch.value = null;
    if (options.setPreviewSelectionRange) {
      options.setPreviewSelectionRange(null);
    }
    clearSelectionPointerListeners();
    resetSuppressNextRulerClick();
  }

  function startSelectionRangeCreate(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (event.pointerId !== undefined && event.target && 'setPointerCapture' in event.target) {
      try {
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // Capture can fail if the pointer was already released; harmless.
      }
    }

    const timeTicks = quantize(options.getTimeTicksFromPointerEvent(event));
    selectionCreateStartTicks.value = timeTicks;
    isCreatingSelectionRange.value = true;

    draggedSelectionPatch.value = {
      startTicks: timeTicks,
      endTicks: timeTicks + getFrameDurationTicks(),
    };

    if (options.setPreviewSelectionRange) {
      options.setPreviewSelectionRange(draggedSelectionPatch.value);
    }

    clearSelectionPointerListeners();
    activeSelectionPointerMove = onSelectionCreatePointerMove;
    activeSelectionPointerUp = () => onSelectionCreatePointerUp();
    activeSelectionKeyDown = onSelectionKeyDown;
    window.addEventListener('pointermove', activeSelectionPointerMove);
    window.addEventListener('pointerup', activeSelectionPointerUp);
    window.addEventListener('pointercancel', activeSelectionPointerUp);
    window.addEventListener('keydown', activeSelectionKeyDown);
  }

  onUnmounted(() => {
    clearSelectionPointerListeners();
  });

  return {
    clearSelectionPointerListeners,
    isCreatingSelectionRange,
    isDraggingSelectionRange,
    startSelectionRangeCreate,
    startSelectionRangeDrag,
    suppressNextRulerClick,
    displaySelectionRange,
  };
}
