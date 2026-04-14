import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { isSecondaryWheel, DRAG_DEADZONE_PX } from '~/utils/mouse';
import { pxToTimeUs } from '~/utils/timeline/geometry';
import type { FastCatUserSettings } from '~/utils/settings';

interface TimelineSelectionStoreLike {
  clearSelection: () => void;
  selectTimelineMarker: (markerId: string) => void;
}

interface TimelineStoreLike {
  applyTimeline: (payload: {
    type: 'add_marker';
    id: string;
    timeUs: number;
    text: string;
  }) => void;
  clearSelection: () => void;
  removeSelectionRange: () => void;
  resetTimelineZoom: () => void;
  fitTimelineZoom: () => void;
  setCurrentTimeUs: (timeUs: number) => void;
}

interface WorkspaceStoreLike {
  userSettings: FastCatUserSettings;
}

interface UseTimelineRulerInteractionsOptions {
  containerRef: Ref<HTMLElement | null>;
  scrollLeft: Ref<number>;
  zoom: Ref<number>;
  timelineStore: TimelineStoreLike;
  selectionStore: TimelineSelectionStoreLike;
  workspaceStore: WorkspaceStoreLike;
  isDraggingSelectionRange: Ref<boolean>;
  suppressNextRulerClick: Ref<boolean>;
  startSelectionRangeCreate: (event: PointerEvent) => void;
  resolvePlayheadClickTimeUs?: (rawTimeUs: number) => number;
  emit: {
    (e: 'pointerdown' | 'start-playhead-drag' | 'start-pan', event: PointerEvent): void;
    (e: 'wheel', event: WheelEvent): void;
    (e: 'dblclick-ruler', timeUs: number): void;
  };
}

function createMarkerId() {
  return `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function useTimelineRulerInteractions(options: UseTimelineRulerInteractionsOptions) {
  const middlePointerDown = ref<{ x: number; y: number; moved: boolean } | null>(null);
  const pendingSelectAreaEvent = ref<PointerEvent | null>(null);

  const rulerSettings = computed(() => options.workspaceStore.userSettings.mouse.ruler);

  function getTimeUsFromMouseEvent(event: MouseEvent): number {
    const rect = options.containerRef.value?.getBoundingClientRect();
    if (!rect) return 0;

    const x = event.clientX - rect.left;
    return pxToTimeUs(options.scrollLeft.value + x, options.zoom.value);
  }

  function executeRulerClickAction(action: string, event: PointerEvent | MouseEvent) {
    if (action === 'none') return;

    if (action === 'seek') {
      const rawTimeUs = getTimeUsFromMouseEvent(event as MouseEvent);
      const timeUs = options.resolvePlayheadClickTimeUs?.(rawTimeUs) ?? rawTimeUs;
      options.timelineStore.setCurrentTimeUs(timeUs);
      return;
    }

    if (action === 'reset_zoom') {
      options.timelineStore.resetTimelineZoom();
      return;
    }

    if (action === 'fit_zoom') {
      options.timelineStore.fitTimelineZoom();
      return;
    }

    if (action === 'select_area') {
      options.startSelectionRangeCreate(event as PointerEvent);
      return;
    }

    if (action === 'clear_selection') {
      options.timelineStore.removeSelectionRange();
      options.timelineStore.clearSelection();
      options.selectionStore.clearSelection();
      return;
    }

    if (action === 'add_marker') {
      const timeUs = getTimeUsFromMouseEvent(event as MouseEvent);
      const markerId = createMarkerId();

      options.timelineStore.applyTimeline({
        type: 'add_marker',
        id: markerId,
        timeUs,
        text: '',
      });
      options.selectionStore.selectTimelineMarker(markerId);
    }
  }

  function onContextMenuOpenChange(isOpen: boolean) {
    if (!isOpen) return;
  }

  function onRulerContextMenu(_event: MouseEvent) {}

  function onRulerClick(event: MouseEvent) {
    if (event.button !== 0) return;
    if (options.suppressNextRulerClick.value) {
      options.suppressNextRulerClick.value = false;
      return;
    }

    const workspaceSettings = options.workspaceStore.userSettings;
    if (isLayer1Active(event, workspaceSettings)) {
      executeRulerClickAction(workspaceSettings.mouse.ruler.shiftClick, event);
      return;
    }

    executeRulerClickAction(workspaceSettings.mouse.ruler.click, event);
  }

  function onRulerDblClick(event: MouseEvent) {
    if (event.button !== 0) return;

    options.emit('dblclick-ruler', getTimeUsFromMouseEvent(event));
    executeRulerClickAction(rulerSettings.value.doubleClick, event);
  }

  function onRulerAuxClick(event: MouseEvent) {
    if (event.button !== 1) return;

    if (middlePointerDown.value?.moved) {
      middlePointerDown.value = null;
      return;
    }

    middlePointerDown.value = null;
    executeRulerClickAction(rulerSettings.value.middleClick, event);
  }

  function handleDragAction(action: string, event: PointerEvent) {
    if (action === 'pan') {
      options.emit('start-pan', event);
      return;
    }

    if (action === 'move_playhead') {
      const rawTimeUs = getTimeUsFromMouseEvent(event);
      const timeUs = options.resolvePlayheadClickTimeUs?.(rawTimeUs) ?? rawTimeUs;
      options.timelineStore.setCurrentTimeUs(timeUs);
      options.emit('start-playhead-drag', event);
      return;
    }

    if (action === 'select_area') {
      pendingSelectAreaEvent.value = event;
      return;
    }

    if (action === 'none') {
      options.emit('pointerdown', event);
    }
  }

  function onRulerPointerDown(event: PointerEvent) {
    if (options.isDraggingSelectionRange.value) return;

    const settings = rulerSettings.value;
    if (event.button === 1) {
      event.preventDefault();
      middlePointerDown.value = { x: event.clientX, y: event.clientY, moved: false };
      (event.currentTarget as HTMLElement | null)?.setPointerCapture(event.pointerId);
      handleDragAction(settings.middleDrag, event);
      return;
    }

    if (event.button !== 0) return;

    event.preventDefault();

    const action = isLayer1Active(event, options.workspaceStore.userSettings)
      ? settings.dragShift
      : settings.drag;
    handleDragAction(action, event);
  }

  function onRulerPointerMove(event: PointerEvent) {
    if (pendingSelectAreaEvent.value) {
      const origin = pendingSelectAreaEvent.value;
      const dx = event.clientX - origin.clientX;
      const dy = event.clientY - origin.clientY;
      if (Math.abs(dx) > DRAG_DEADZONE_PX || Math.abs(dy) > DRAG_DEADZONE_PX) {
        pendingSelectAreaEvent.value = null;
        options.startSelectionRangeCreate(origin);
      }
    }

    if (!middlePointerDown.value) return;

    const dx = event.clientX - middlePointerDown.value.x;
    const dy = event.clientY - middlePointerDown.value.y;
    if (Math.abs(dx) > DRAG_DEADZONE_PX || Math.abs(dy) > DRAG_DEADZONE_PX) {
      middlePointerDown.value.moved = true;
    }
  }

  function onRulerPointerUp() {
    pendingSelectAreaEvent.value = null;
  }

  function onRulerPointerCancel() {
    pendingSelectAreaEvent.value = null;
    middlePointerDown.value = null;
  }

  function onRulerWheel(event: WheelEvent) {
    const action = isSecondaryWheel(event)
      ? rulerSettings.value.wheelSecondary
      : rulerSettings.value.wheel;

    event.preventDefault();
    if (action === 'none') return;

    options.emit('wheel', event);
  }

  onMounted(() => {
    options.containerRef.value?.addEventListener('wheel', onRulerWheel, { passive: false });
  });

  onBeforeUnmount(() => {
    options.containerRef.value?.removeEventListener('wheel', onRulerWheel);
  });

  return {
    executeRulerClickAction,
    getTimeUsFromMouseEvent,
    onContextMenuOpenChange,
    onRulerAuxClick,
    onRulerClick,
    onRulerContextMenu,
    onRulerDblClick,
    onRulerPointerCancel,
    onRulerPointerDown,
    onRulerPointerMove,
    onRulerPointerUp,
    rulerSettings,
  };
}
