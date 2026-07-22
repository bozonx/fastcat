<script setup lang="ts">
import { watch, computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import { useSelectionStore } from '~/stores/selection.store';
import {
  truncateRulerTooltip,
  useTimelineRulerPresentation,
} from '~/composables/timeline/useTimelineRulerPresentation';
import { useTimelineHoverState } from '~/composables/timeline/useTimelineHoverState';
import { useTimelineRulerMenus } from '~/composables/timeline/useTimelineRulerMenus';
import { useTimelineRulerMarkerDrag } from '~/composables/timeline/useTimelineRulerMarkerDrag';
import { useTimelineRulerSelectionDrag } from '~/composables/timeline/useTimelineRulerSelectionDrag';
import { useTimelineRulerDraw } from '~/composables/timeline/useTimelineRulerDraw';
import { useTimelineRulerInteractions } from '~/composables/timeline/useTimelineRulerInteractions';
import { useExclusiveContextMenu } from '~/composables/ui/useExclusiveContextMenu';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import {
  computeSnapTargetsTicks,
  resolvePlayheadClickTimeTicks,
} from '~/composables/timeline/timeline-drag-domain';
import { pxToTimeTicks } from '~/utils/timeline/geometry';

const { t } = useI18n();

const props = defineProps<{
  scrollEl: HTMLElement | null;
  scrollLeft?: number;
  isMobile?: boolean;
}>();

const emit = defineEmits<{
  (e: 'pointerdown' | 'start-playhead-drag' | 'start-pan', event: PointerEvent): void;
  (e: 'wheel', event: WheelEvent): void;
  (e: 'dblclick-ruler', timeTicks: number): void;
  (e: 'middleclick-ruler', event: MouseEvent): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const { isContextMenuOpen, setContextMenuOpen } = useExclusiveContextMenu();
const isMobileRulerDrawerOpen = ref(false);

const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const workspaceStore = useWorkspaceStore();
const timelineSettingsStore = useTimelineSettingsStore();

const width = ref(0);
const height = ref(0);
const scrollLeft = computed(() => props.scrollLeft ?? timelineStore.timelineScrollLeftPx);

const markers = computed(() => timelineStore.markers);
const selectionRange = computed(() => timelineStore.selectionRange);

// --- Styling Settings (Adjust these for desired look) ---
const textColor = 'rgba(255, 255, 255, 0.5)';
const tickColor = 'rgba(255, 255, 255, 0.2)';
const majorTickWidth = 1.25;
const subTickWidth = 0.8;
// ---------------------------------------------------------

const fps = computed(() => timelineStore.timelineFormat.fps || 30);
const zoom = computed(() => timelineStore.timelineZoom);

function getTimeTicksFromRulerClientEvent(event: MouseEvent | PointerEvent): number {
  const rect = containerRef.value?.getBoundingClientRect();
  if (!rect) return 0;
  const x = event.clientX - rect.left;
  return pxToTimeTicks(scrollLeft.value + x, zoom.value);
}

const snapThresholdPx = computed(() => workspaceStore.userSettings.timeline.snapThresholdPx);

function getSnappedPlayheadTimeTicks(rawTimeTicks: number) {
  const timelineEndTicks = Number.isFinite(timelineStore.duration)
    ? Math.max(0, Math.round(timelineStore.duration))
    : null;

  return resolvePlayheadClickTimeTicks({
    rawTimeTicks,
    zoom: zoom.value,
    snapThresholdPx: snapThresholdPx.value,
    toolbarSnapMode: timelineSettingsStore.toolbarSnapMode,
    snapping: workspaceStore.userSettings.timeline.snapping,
    tracks: timelineStore.timelineDoc?.tracks ?? [],
    markers: timelineStore.markers,
    durationTicks: timelineEndTicks,
    selectionRangeTicks: isDraggingSelectionRange.value ? null : timelineStore.selectionRange,
  });
}

function computeSnapTargets(excludeMarkerId?: string) {
  const snapSettings = workspaceStore.userSettings.timeline.snapping;
  const timelineEndTicks = Number.isFinite(timelineStore.duration)
    ? Math.max(0, Math.round(timelineStore.duration))
    : null;

  return computeSnapTargetsTicks({
    tracks: timelineStore.timelineDoc?.tracks ?? [],
    excludeMarkerId,
    includeTimelineStart: snapSettings.timelineEdges,
    includeTimelineEndTicks: snapSettings.timelineEdges ? timelineEndTicks : null,
    includePlayheadTicks: snapSettings.playhead ? timelineStore.currentTime : null,
    includeMarkers: snapSettings.markers,
    markers: timelineStore.markers,
    includeClips: snapSettings.clips,
    selectionRangeTicks:
      snapSettings.selection && !isDraggingSelectionRange.value
        ? timelineStore.selectionRange
        : null,
  });
}

const { canvasStyle, scheduleDraw } = useTimelineRulerDraw({
  containerRef,
  canvasRef,
  width,
  height,
  scrollLeft,
  zoom,
  fps,
  textColor,
  tickColor,
  majorTickWidth,
  subTickWidth,
  interfaceScale: computed(() => workspaceStore.userSettings.ui.interfaceScale),
  isMobile: computed(() => props.isMobile),
});

watch([fps, zoom, () => workspaceStore.userSettings.ui.interfaceScale], () => {
  scheduleDraw();
});

watch(markers, () => {
  scheduleDraw();
});

watch(selectionRange, () => {
  scheduleDraw();
});

function deleteMarker(markerId: string) {
  timelineStore.removeMarker(markerId);
}

function selectMarker(markerId: string, e?: MouseEvent) {
  // Always stop propagation so the ruler's own click/pointerdown actions are not triggered
  e?.stopPropagation();

  const currentIds = getSelectedMarkerIds();

  if (e?.shiftKey) {
    if (currentIds.includes(markerId)) {
      const next = currentIds.filter((id) => id !== markerId);
      selectionStore.selectTimelineMarkers(next);
    } else {
      selectionStore.selectTimelineMarkers([...currentIds, markerId]);
    }
    return;
  }

  // Clicking an already-selected marker preserves the selection (for dragging)
  if (currentIds.includes(markerId)) {
    return;
  }

  selectionStore.selectTimelineMarker(markerId);
}

function getSelectedMarkerIds(): string[] {
  const entity = selectionStore.selectedEntity;
  if (!entity || entity.source !== 'timeline') return [];
  if (entity.kind === 'marker') return [entity.markerId];
  if (entity.kind === 'markers') return entity.markerIds;
  return [];
}

function seekToMarker(markerId: string, e?: MouseEvent, part?: 'left' | 'right') {
  e?.stopPropagation();
  // If this click followed an actual drag gesture, don't seek — the drag already handled the interaction
  if (hasDragged.value) {
    return;
  }

  // Layer-2 (default Ctrl) click selects the marker without moving the playhead.
  // Selection itself already happened on pointerdown, so there is nothing else to do.
  if (e && isLayer2Active(e, workspaceStore.userSettings)) {
    return;
  }

  const marker = markers.value.find((m) => m.id === markerId);
  if (!marker) return;

  const timeTicks =
    part === 'right' && marker.durationTicks !== undefined
      ? marker.timeTicks + marker.durationTicks
      : marker.timeTicks;

  timelineStore.setCurrentTimeTicks(timeTicks);

  // Don't override multi-selection when shift is held
  if (!e?.shiftKey) {
    selectionStore.selectTimelineMarker(markerId);
  }
}

// Layer-2 (default Ctrl) + drag on a zone marker's body moves the whole zone.
// Without the modifier the event bubbles to the ruler (e.g. move playhead).
function onZoneBodyPointerDown(event: PointerEvent, markerId: string) {
  if (event.button !== 0) return;
  if (!isLayer2Active(event, workspaceStore.userSettings)) return;

  event.stopPropagation();
  // Prevent the trailing ruler click (after a Ctrl+click without a drag) from seeking.
  suppressNextRulerClickMarker.value = true;
  onMarkerPointerDown(event, markerId, 'move');
}

function selectSelectionRange(e?: MouseEvent) {
  if (e && isLayer1Active(e, workspaceStore.userSettings)) {
    executeRulerClickAction(workspaceStore.userSettings.mouse.ruler.shiftClick, e);
    return;
  }
  e?.stopPropagation();
  selectionStore.selectTimelineSelectionRange();
  if (e) {
    timelineStore.setCurrentTimeTicks(getTimeTicksFromRulerClientEvent(e));
  }
}

const isSnappingEnabled = computed(() => timelineSettingsStore.toolbarSnapMode !== 'no_snap');

const {
  onMarkerPointerDown,
  displayMarkers,
  draggedMarkerId,
  hasDragged,
  suppressNextRulerClick: suppressNextRulerClickMarker,
} = useTimelineRulerMarkerDrag({
  markers,
  zoom,
  fps,
  selectMarker,
  updateMarker: timelineStore.updateMarker,
  getSelectedMarkerIds,
  computeSnapTargets,
  snapThresholdPx: computed(() => snapThresholdPx.value),
  isSnappingEnabled,
  scrollLeft,
  getTimeTicksFromPointerEvent: (event) => getTimeTicksFromMouseEvent(event),
});

const {
  isDraggingSelectionRange,
  isCreatingSelectionRange: _isCreatingSelectionRange,
  startSelectionRangeDrag,
  startSelectionRangeCreate,
  suppressNextRulerClick: suppressNextRulerClickSelection,
  displaySelectionRange,
} = useTimelineRulerSelectionDrag({
  selectionRange,
  zoom,
  fps,
  scrollLeft,
  getTimeTicksFromPointerEvent: (event) => getTimeTicksFromMouseEvent(event),
  selectSelectionRange,
  updateSelectionRange: timelineStore.updateSelectionRange,
  createSelectionRange: timelineStore.createSelectionRange,
  setPreviewSelectionRange: timelineStore.setPreviewSelectionRange,
  computeSnapTargets,
  snapThresholdPx,
  isSnappingEnabled,
});

const { hoveredMarkerId } = useTimelineHoverState();

const { markerPoints, selectionRangePoint, currentFrameHighlightStyle, playheadStyle } =
  useTimelineRulerPresentation({
    width,
    scrollLeft,
    zoom,
    fps,
    currentTime: computed(() => timelineStore.currentTime),
    markers: displayMarkers,
    selectionRange: displaySelectionRange,
    hoveredMarkerId,
    draggedMarkerId,
  });

const suppressNextRulerClick = computed({
  get: () => suppressNextRulerClickMarker.value || suppressNextRulerClickSelection.value,
  set: (val) => {
    suppressNextRulerClickMarker.value = val;
    suppressNextRulerClickSelection.value = val;
  },
});

const {
  executeRulerClickAction,
  getTimeTicksFromMouseEvent,
  onContextMenuOpenChange,
  onRulerAuxClick,
  onRulerClick,
  onRulerContextMenu,
  onRulerDblClick,
  onRulerPointerCancel,
  onRulerPointerDown,
  onRulerPointerMove,
  onRulerPointerUp,
  lastRightClickTimeTicks,
} = useTimelineRulerInteractions({
  containerRef,
  scrollLeft,
  zoom,
  timelineStore,
  selectionStore,
  workspaceStore,
  isDraggingSelectionRange,
  suppressNextRulerClick,
  startSelectionRangeCreate,
  resolvePlayheadClickTimeTicks: getSnappedPlayheadTimeTicks,
  emit,
});

function setRulerContextMenuOpen(open: boolean) {
  if (props.isMobile) {
    if (open) {
      isMobileRulerDrawerOpen.value = true;
    }
    return;
  }
  setContextMenuOpen(open);
  onContextMenuOpenChange(open);
}

function handleRulerContextMenu(event: MouseEvent) {
  onRulerContextMenu(event);
  if (props.isMobile) {
    event.preventDefault();
    event.stopPropagation();
    isMobileRulerDrawerOpen.value = true;
  }
}

const {
  rulerContextMenuItems,
  getZoneMarkerMenuItems,
  getMarkerMenuItems,
  selectionRangeMenuItems,
} = useTimelineRulerMenus({
  t,
  timelineStore,
  selectMarker,
  deleteMarker,
  getRightClickTimeTicks: () => lastRightClickTimeTicks.value,
});

const isSelectionRangeSelected = computed(
  () =>
    selectionStore.selectedEntity?.source === 'timeline' &&
    selectionStore.selectedEntity?.kind === 'selection-range',
);

function isMarkerSelected(markerId: string) {
  return selectionStore.isMarkerSelected(markerId);
}

const mobileScrubActive = ref(false);
const lastTapTime = ref(0);
const lastTapPos = ref({ x: 0, y: 0 });
const DOUBLE_TAP_TIMEOUT_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 30;

/**
 * Mobile-specific pointer handler for the ruler.
 * - Detects double-tap to create a marker at the playhead position.
 * - If a marker is selected and the touch lands within 40px of it: starts marker drag.
 * - Otherwise: captures pointer and scrubs playhead continuously.
 */
function onMobilePointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();

  const now = Date.now();
  const dx = Math.abs(event.clientX - lastTapPos.value.x);
  const dy = Math.abs(event.clientY - lastTapPos.value.y);

  if (
    now - lastTapTime.value < DOUBLE_TAP_TIMEOUT_MS &&
    dx < DOUBLE_TAP_DISTANCE_PX &&
    dy < DOUBLE_TAP_DISTANCE_PX
  ) {
    timelineStore.addMarkerAtPlayhead();
    lastTapTime.value = 0;
    mobileScrubActive.value = false;
    return;
  }

  lastTapTime.value = now;
  lastTapPos.value = { x: event.clientX, y: event.clientY };

  const sel = selectionStore.selectedEntity;
  if (sel?.source === 'timeline' && sel.kind === 'marker') {
    const mp = markerPoints.value.find((p) => p.id === sel.markerId);
    if (mp) {
      const rect = containerRef.value?.getBoundingClientRect();
      if (rect) {
        const touchX = event.clientX - rect.left;
        if (Math.abs(touchX - mp.x) < 40) {
          onMarkerPointerDown(event, sel.markerId);
          return;
        }
      }
    }
  }

  mobileScrubActive.value = true;
  containerRef.value?.setPointerCapture(event.pointerId);
  timelineStore.setCurrentTimeTicks(getSnappedPlayheadTimeTicks(getTimeTicksFromMouseEvent(event)));
}

function onMobilePointerMove(event: PointerEvent) {
  if (!mobileScrubActive.value) return;
  timelineStore.setCurrentTimeTicks(getTimeTicksFromMouseEvent(event));
}

function onMobilePointerUp() {
  mobileScrubActive.value = false;
}
</script>

<template>
  <UContextMenu
    :disabled="isMobile"
    :open="isMobile ? false : isContextMenuOpen"
    :items="rulerContextMenuItems"
    class="w-full h-full"
    @update:open="setRulerContextMenuOpen"
  >
    <div
      ref="containerRef"
      data-testid="timeline-ruler"
      class="relative w-full h-full overflow-hidden cursor-pointer"
      :class="isMobile ? '' : 'touch-none'"
      @contextmenu="handleRulerContextMenu"
      @click="onRulerClick"
      @dblclick="onRulerDblClick"
      @auxclick="onRulerAuxClick"
      @pointerdown="isMobile ? onMobilePointerDown($event) : onRulerPointerDown($event)"
      @pointermove="isMobile ? onMobilePointerMove($event) : onRulerPointerMove($event)"
      @pointerup="isMobile ? onMobilePointerUp() : onRulerPointerUp()"
      @pointercancel="isMobile ? onMobilePointerUp() : onRulerPointerCancel()"
      @mouseleave="hoveredMarkerId = null"
    >
      <canvas
        ref="canvasRef"
        class="absolute top-0 left-0 pointer-events-none"
        :style="canvasStyle"
      />

      <div
        v-if="currentFrameHighlightStyle"
        class="absolute inset-y-0 pointer-events-none"
        :style="{
          ...currentFrameHighlightStyle,
          willChange: 'transform',
          backgroundColor: '#888888',
          opacity: '0.12',
        }"
      />

      <div
        class="absolute inset-y-0 w-0 pointer-events-none z-50"
        :style="{ ...playheadStyle, willChange: 'transform' }"
      >
        <div
          class="absolute left-0 bottom-0 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-b-0 border-l-transparent border-r-transparent"
          :class="isMobile ? 'border-t-[20px]' : 'border-t-10'"
          :style="{ borderTopColor: '#ef4444' }"
        />
      </div>

      <TimelineRulerOverlays
        :marker-points="markerPoints"
        :selection-range-point="selectionRangePoint"
        :selection-range-menu-items="selectionRangeMenuItems"
        :get-zone-marker-menu-items="getZoneMarkerMenuItems"
        :get-marker-menu-items="getMarkerMenuItems"
        :is-marker-selected="isMarkerSelected"
        :is-selection-range-selected="isSelectionRangeSelected"
        :truncate-tooltip="truncateRulerTooltip"
        :selection-start-handle-label="t('fastcat.timeline.selectionStartHandle')"
        :selection-end-handle-label="t('fastcat.timeline.selectionEndHandle')"
        :marker-label="t('fastcat.timeline.marker')"
        :zone-marker-start-label="t('fastcat.timeline.zoneMarkerStart')"
        :zone-marker-end-label="t('fastcat.timeline.zoneMarkerEnd')"
        :is-mobile="isMobile"
        @seek-to-marker="seekToMarker"
        @marker-pointerdown="onMarkerPointerDown"
        @zone-body-pointerdown="onZoneBodyPointerDown"
        @select-selection-range="selectSelectionRange"
        @selection-range-pointerdown="startSelectionRangeDrag"
      />
    </div>
  </UContextMenu>

  <UiMobileDrawer
    v-if="isMobile"
    v-model:open="isMobileRulerDrawerOpen"
    :title="t('fastcat.timeline.rulerActions')"
  >
    <div class="p-4 flex flex-col gap-2">
      <template v-for="(group, gIdx) in rulerContextMenuItems" :key="gIdx">
        <button
          v-for="(item, iIdx) in group"
          :key="iIdx"
          type="button"
          class="flex items-center gap-3 px-4 py-3 rounded-lg bg-ui-bg-elevated hover:bg-ui-bg-accent active:bg-ui-bg-accent/80 text-left text-sm font-medium transition-colors cursor-pointer"
          :class="item.color === 'red' ? 'text-red-400' : 'text-ui-text'"
          @click="
            isMobileRulerDrawerOpen = false;
            item.onSelect?.();
          "
        >
          <UIcon v-if="item.icon" :name="item.icon" class="w-5 h-5 shrink-0" />
          <span>{{ item.label }}</span>
        </button>
      </template>
    </div>
  </UiMobileDrawer>
</template>
