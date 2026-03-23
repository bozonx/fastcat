import { onUnmounted, ref, type Ref, computed } from 'vue';
import { pxToTimeUs, pickBestSnapCandidateUs, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { quantizeTimeUsToFrames } from '~/timeline/commands/utils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  createDefaultHotkeyLookup,
  createHotkeyLookup,
  isCommandMatched,
} from '~/utils/hotkeys/runtime';

export type TimelineRulerSelectionDragPart = 'move' | 'left' | 'right';

interface SelectionRangeLike {
  startUs: number;
  endUs: number;
}

interface UseTimelineRulerSelectionDragOptions {
  selectionRange: Ref<SelectionRangeLike | null | undefined>;
  zoom: Ref<number>;
  fps: Ref<number>;
  getTimeUsFromPointerEvent: (event: PointerEvent) => number;
  selectSelectionRange: () => void;
  updateSelectionRange: (payload: { startUs: number; endUs: number } | null) => void;
  createSelectionRange: (payload: { startUs: number; endUs: number }) => void;
  setPreviewSelectionRange?: (payload: { startUs: number; endUs: number } | null) => void;
  computeSnapTargets?: () => number[];
  snapThresholdPx?: Ref<number> | number;
}

export function useTimelineRulerSelectionDrag(options: UseTimelineRulerSelectionDragOptions) {
  const isDraggingSelectionRange = ref(false);
  const selectionDragPart = ref<TimelineRulerSelectionDragPart>('move');
  const selectionDragStartX = ref(0);
  const selectionDragStartStartUs = ref(0);
  const selectionDragStartEndUs = ref(0);
  const draggedSelectionPatch = ref<{ startUs: number; endUs: number } | null>(null);
  const workspaceStore = useWorkspaceStore();

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
  const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));

  const suppressNextRulerClick = ref(false);
  const isCreatingSelectionRange = ref(false);
  const selectionCreateStartUs = ref(0);

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

  function quantize(timeUs: number) {
    return quantizeTimeUsToFrames(timeUs, options.fps.value, 'round');
  }

  function getFrameDurationUs() {
    return Math.max(1, Math.round(1_000_000 / options.fps.value));
  }

  function getSnapThresholdPx() {
    return typeof options.snapThresholdPx === 'number'
      ? options.snapThresholdPx
      : (options.snapThresholdPx?.value ?? 0);
  }

  function updateSelectionRangeFromDrag(clientX: number) {
    const range = options.selectionRange.value;
    if (!range) return;

    const dx = clientX - selectionDragStartX.value;
    const deltaUs = pxToTimeUs(Math.abs(dx), options.zoom.value) * (dx < 0 ? -1 : 1);
    const minDurationUs = Math.max(
      getFrameDurationUs(),
      pxToTimeUs(TIMELINE_RULER_CONSTANTS.MIN_SELECTION_DURATION_PX, options.zoom.value),
    );

    if (selectionDragPart.value === 'move') {
      const durationUs = selectionDragStartEndUs.value - selectionDragStartStartUs.value;
      let nextStartUs = Math.max(0, quantize(selectionDragStartStartUs.value + deltaUs));
      let nextEndUs = nextStartUs + durationUs;

      if (options.computeSnapTargets && options.snapThresholdPx) {
        const thresholdUs = Math.round(
          (getSnapThresholdPx() / zoomToPxPerSecond(options.zoom.value)) * 1e6,
        );
        const targets = options.computeSnapTargets();

        const snapStart = pickBestSnapCandidateUs({
          rawUs: nextStartUs,
          thresholdUs,
          targetsUs: targets,
        });
        const snapEnd = pickBestSnapCandidateUs({
          rawUs: nextEndUs,
          thresholdUs,
          targetsUs: targets,
        });

        if (snapStart.distUs < thresholdUs && snapStart.distUs <= snapEnd.distUs) {
          nextStartUs = snapStart.snappedUs;
          nextEndUs = nextStartUs + durationUs;
        } else if (snapEnd.distUs < thresholdUs) {
          nextEndUs = snapEnd.snappedUs;
          nextStartUs = Math.max(0, nextEndUs - durationUs);
        }
      }

      draggedSelectionPatch.value = {
        startUs: nextStartUs,
        endUs: nextEndUs,
      };
      if (options.setPreviewSelectionRange) {
        options.setPreviewSelectionRange(draggedSelectionPatch.value);
      }
      return;
    }

    if (selectionDragPart.value === 'left') {
      const maxStartUs = selectionDragStartEndUs.value - minDurationUs;
      let nextStartUs = Math.max(
        0,
        Math.min(maxStartUs, quantize(selectionDragStartStartUs.value + deltaUs)),
      );

      if (options.computeSnapTargets && options.snapThresholdPx) {
        const thresholdUs = Math.round(
          (getSnapThresholdPx() / zoomToPxPerSecond(options.zoom.value)) * 1e6,
        );
        const targets = options.computeSnapTargets();
        const snap = pickBestSnapCandidateUs({
          rawUs: nextStartUs,
          thresholdUs,
          targetsUs: targets,
        });
        if (snap.distUs < thresholdUs) {
          nextStartUs = Math.max(0, Math.min(maxStartUs, snap.snappedUs));
        }
      }

      draggedSelectionPatch.value = {
        startUs: nextStartUs,
        endUs: selectionDragStartEndUs.value,
      };
      if (options.setPreviewSelectionRange) {
        options.setPreviewSelectionRange(draggedSelectionPatch.value);
      }
      return;
    }

    let nextEndUs = Math.max(
      selectionDragStartStartUs.value + minDurationUs,
      quantize(selectionDragStartEndUs.value + deltaUs),
    );

    if (options.computeSnapTargets && options.snapThresholdPx) {
      const thresholdUs = Math.round(
        (getSnapThresholdPx() / zoomToPxPerSecond(options.zoom.value)) * 1e6,
      );
      const targets = options.computeSnapTargets();
      const snap = pickBestSnapCandidateUs({ rawUs: nextEndUs, thresholdUs, targetsUs: targets });
      if (snap.distUs < thresholdUs) {
        nextEndUs = Math.max(selectionDragStartStartUs.value + minDurationUs, snap.snappedUs);
      }
    }

    draggedSelectionPatch.value = {
      startUs: selectionDragStartStartUs.value,
      endUs: nextEndUs,
    };
    if (options.setPreviewSelectionRange) {
      options.setPreviewSelectionRange(draggedSelectionPatch.value);
    }
  }

  function onSelectionPointerMove(event: PointerEvent) {
    if (!isDraggingSelectionRange.value) return;
    suppressNextRulerClick.value = true;
    updateSelectionRangeFromDrag(event.clientX);
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

    options.selectSelectionRange();
    isDraggingSelectionRange.value = true;
    selectionDragPart.value = part;
    selectionDragStartX.value = event.clientX;
    selectionDragStartStartUs.value = options.selectionRange.value.startUs;
    selectionDragStartEndUs.value = options.selectionRange.value.endUs;
    draggedSelectionPatch.value = null;
    suppressNextRulerClick.value = part !== 'move';

    clearSelectionPointerListeners();
    activeSelectionPointerMove = onSelectionPointerMove;
    activeSelectionPointerUp = () => onSelectionPointerUp();
    activeSelectionKeyDown = onSelectionKeyDown;
    window.addEventListener('pointermove', activeSelectionPointerMove);
    window.addEventListener('pointerup', activeSelectionPointerUp);
    window.addEventListener('keydown', activeSelectionKeyDown);
  }

  function onSelectionCreatePointerMove(event: PointerEvent) {
    if (!isCreatingSelectionRange.value) return;

    suppressNextRulerClick.value = true;
    let currentUs = quantize(options.getTimeUsFromPointerEvent(event));

    if (options.computeSnapTargets && options.snapThresholdPx) {
      const thresholdUs = Math.round(
        (getSnapThresholdPx() / zoomToPxPerSecond(options.zoom.value)) * 1e6,
      );
      const targets = options.computeSnapTargets();
      const snap = pickBestSnapCandidateUs({
        rawUs: currentUs,
        thresholdUs,
        targetsUs: targets,
      });
      if (snap.distUs < thresholdUs) {
        currentUs = snap.snappedUs;
      }
    }

    const startUs = Math.min(selectionCreateStartUs.value, currentUs);
    const endUs = Math.max(selectionCreateStartUs.value, currentUs);

    draggedSelectionPatch.value = {
      startUs,
      endUs: Math.max(startUs + getFrameDurationUs(), endUs),
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

    const timeUs = quantize(options.getTimeUsFromPointerEvent(event));
    selectionCreateStartUs.value = timeUs;
    isCreatingSelectionRange.value = true;

    draggedSelectionPatch.value = {
      startUs: timeUs,
      endUs: timeUs + getFrameDurationUs(),
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
