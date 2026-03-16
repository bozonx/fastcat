import { onUnmounted, ref, type Ref, computed } from 'vue';
import { pxToTimeUs } from '~/utils/timeline/geometry';
import { TIMELINE_RULER_CONSTANTS } from '~/utils/constants';
import { quantizeTimeUsToFrames } from '~/timeline/commands/utils';

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
}

export function useTimelineRulerSelectionDrag(options: UseTimelineRulerSelectionDragOptions) {
  const isDraggingSelectionRange = ref(false);
  const selectionDragPart = ref<TimelineRulerSelectionDragPart>('move');
  const selectionDragStartX = ref(0);
  const selectionDragStartStartUs = ref(0);
  const selectionDragStartEndUs = ref(0);
  const draggedSelectionPatch = ref<{ startUs: number; endUs: number } | null>(null);

  const suppressNextRulerClick = ref(false);
  const isCreatingSelectionRange = ref(false);
  const selectionCreateStartUs = ref(0);

  const displaySelectionRange = computed(() => {
    if (isDraggingSelectionRange.value && draggedSelectionPatch.value) {
      return draggedSelectionPatch.value;
    }
    return options.selectionRange.value;
  });

  let activeSelectionPointerMove: ((event: PointerEvent) => void) | null = null;
  let activeSelectionPointerUp: ((event: PointerEvent) => void) | null = null;

  function clearSelectionPointerListeners() {
    if (activeSelectionPointerMove) {
      window.removeEventListener('pointermove', activeSelectionPointerMove);
      activeSelectionPointerMove = null;
    }

    if (activeSelectionPointerUp) {
      window.removeEventListener('pointerup', activeSelectionPointerUp);
      activeSelectionPointerUp = null;
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

  function updateSelectionRangeFromDrag(clientX: number) {
    const range = options.selectionRange.value;
    if (!range) return;

    const dx = clientX - selectionDragStartX.value;
    const deltaUs = pxToTimeUs(Math.abs(dx), options.zoom.value) * (dx < 0 ? -1 : 1);
    const minDurationUs = Math.max(
      1,
      pxToTimeUs(TIMELINE_RULER_CONSTANTS.MIN_SELECTION_DURATION_PX, options.zoom.value),
    );

    if (selectionDragPart.value === 'move') {
      const durationUs = selectionDragStartEndUs.value - selectionDragStartStartUs.value;
      const nextStartUs = Math.max(0, quantize(selectionDragStartStartUs.value + deltaUs));
      draggedSelectionPatch.value = {
        startUs: nextStartUs,
        endUs: nextStartUs + durationUs,
      };
      return;
    }

    if (selectionDragPart.value === 'left') {
      const maxStartUs = selectionDragStartEndUs.value - minDurationUs;
      const nextStartUs = Math.max(
        0,
        Math.min(maxStartUs, quantize(selectionDragStartStartUs.value + deltaUs)),
      );
      draggedSelectionPatch.value = {
        startUs: nextStartUs,
        endUs: selectionDragStartEndUs.value,
      };
      return;
    }

    const nextEndUs = Math.max(
      selectionDragStartStartUs.value + minDurationUs,
      quantize(selectionDragStartEndUs.value + deltaUs),
    );
    draggedSelectionPatch.value = {
      startUs: selectionDragStartStartUs.value,
      endUs: nextEndUs,
    };
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
    resetSuppressNextRulerClick();
    clearSelectionPointerListeners();
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
    window.addEventListener('pointermove', activeSelectionPointerMove);
    window.addEventListener('pointerup', activeSelectionPointerUp);
  }

  function onSelectionCreatePointerMove(event: PointerEvent) {
    if (!isCreatingSelectionRange.value) return;

    suppressNextRulerClick.value = true;
    const currentUs = options.getTimeUsFromPointerEvent(event);
    const startUs = Math.min(selectionCreateStartUs.value, currentUs);
    const endUs = Math.max(selectionCreateStartUs.value, currentUs);

    draggedSelectionPatch.value = {
      startUs: quantize(startUs),
      endUs: Math.max(quantize(startUs) + 1, quantize(endUs)),
    };
  }

  function onSelectionCreatePointerUp() {
    if (isCreatingSelectionRange.value && draggedSelectionPatch.value) {
      options.createSelectionRange(draggedSelectionPatch.value);
    } else {
      options.updateSelectionRange(null);
    }

    isCreatingSelectionRange.value = false;
    draggedSelectionPatch.value = null;
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
      endUs: timeUs + 1,
    };

    clearSelectionPointerListeners();
    activeSelectionPointerMove = onSelectionCreatePointerMove;
    activeSelectionPointerUp = () => onSelectionCreatePointerUp();
    window.addEventListener('pointermove', activeSelectionPointerMove);
    window.addEventListener('pointerup', activeSelectionPointerUp);
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
