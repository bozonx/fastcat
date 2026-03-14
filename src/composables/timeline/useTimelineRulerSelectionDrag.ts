import { onUnmounted, ref, type Ref } from 'vue';
import { pxToTimeUs } from '~/utils/timeline/geometry';

export type TimelineRulerSelectionDragPart = 'move' | 'left' | 'right';

interface SelectionRangeLike {
  startUs: number;
  endUs: number;
}

interface UseTimelineRulerSelectionDragOptions {
  selectionRange: Ref<SelectionRangeLike | null | undefined>;
  zoom: Ref<number>;
  getTimeUsFromPointerEvent: (event: PointerEvent) => number;
  selectSelectionRange: () => void;
  updateSelectionRange: (payload: { startUs: number; endUs: number }) => void;
  createSelectionRange: (payload: { startUs: number; endUs: number }) => void;
}

export function useTimelineRulerSelectionDrag(options: UseTimelineRulerSelectionDragOptions) {
  const isDraggingSelectionRange = ref(false);
  const selectionDragPart = ref<TimelineRulerSelectionDragPart>('move');
  const selectionDragStartX = ref(0);
  const selectionDragStartStartUs = ref(0);
  const selectionDragStartEndUs = ref(0);
  const suppressNextRulerClick = ref(false);
  const isCreatingSelectionRange = ref(false);
  const selectionCreateStartUs = ref(0);

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

  function updateSelectionRangeFromDrag(clientX: number) {
    const range = options.selectionRange.value;
    if (!range) return;

    const dx = clientX - selectionDragStartX.value;
    const deltaUs = pxToTimeUs(Math.abs(dx), options.zoom.value) * (dx < 0 ? -1 : 1);
    const minDurationUs = Math.max(1, pxToTimeUs(6, options.zoom.value));

    if (selectionDragPart.value === 'move') {
      const durationUs = selectionDragStartEndUs.value - selectionDragStartStartUs.value;
      const nextStartUs = Math.max(0, Math.round(selectionDragStartStartUs.value + deltaUs));
      options.updateSelectionRange({
        startUs: nextStartUs,
        endUs: nextStartUs + durationUs,
      });
      return;
    }

    if (selectionDragPart.value === 'left') {
      const maxStartUs = selectionDragStartEndUs.value - minDurationUs;
      const nextStartUs = Math.max(
        0,
        Math.min(maxStartUs, Math.round(selectionDragStartStartUs.value + deltaUs)),
      );
      options.updateSelectionRange({
        startUs: nextStartUs,
        endUs: selectionDragStartEndUs.value,
      });
      return;
    }

    const nextEndUs = Math.max(
      selectionDragStartStartUs.value + minDurationUs,
      Math.round(selectionDragStartEndUs.value + deltaUs),
    );
    options.updateSelectionRange({
      startUs: selectionDragStartStartUs.value,
      endUs: nextEndUs,
    });
  }

  function onSelectionPointerMove(event: PointerEvent) {
    if (!isDraggingSelectionRange.value) return;
    suppressNextRulerClick.value = true;
    updateSelectionRangeFromDrag(event.clientX);
  }

  function onSelectionPointerUp() {
    isDraggingSelectionRange.value = false;
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

    options.createSelectionRange({
      startUs,
      endUs: Math.max(startUs + 1, endUs),
    });
  }

  function onSelectionCreatePointerUp() {
    isCreatingSelectionRange.value = false;
    clearSelectionPointerListeners();
    resetSuppressNextRulerClick();
  }

  function startSelectionRangeCreate(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();

    const timeUs = options.getTimeUsFromPointerEvent(event);
    selectionCreateStartUs.value = timeUs;
    isCreatingSelectionRange.value = true;

    options.createSelectionRange({
      startUs: timeUs,
      endUs: timeUs + 1,
    });

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
  };
}
