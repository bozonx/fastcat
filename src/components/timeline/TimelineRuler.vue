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
import {
  computeSnapTargetsUs,
  resolvePlayheadClickTimeUs,
} from '~/composables/timeline/timeline-drag-domain';
import { pxToTimeUs } from '~/utils/timeline/geometry';

const { t } = useI18n();

const props = defineProps<{
  scrollEl: HTMLElement | null;
  scrollLeft?: number;
  isMobile?: boolean;
}>();

const emit = defineEmits<{
  (e: 'pointerdown' | 'start-playhead-drag' | 'start-pan', event: PointerEvent): void;
  (e: 'wheel', event: WheelEvent): void;
  (e: 'dblclick-ruler', timeUs: number): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);

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

function getTimeUsFromRulerClientEvent(event: MouseEvent | PointerEvent): number {
  const rect = containerRef.value?.getBoundingClientRect();
  if (!rect) return 0;
  const x = event.clientX - rect.left;
  return pxToTimeUs(scrollLeft.value + x, zoom.value);
}

const snapThresholdPx = computed(() => workspaceStore.userSettings.timeline.snapThresholdPx);

function getSnappedPlayheadTimeUs(rawTimeUs: number) {
  const timelineEndUs = Number.isFinite(timelineStore.duration)
    ? Math.max(0, Math.round(timelineStore.duration))
    : null;

  return resolvePlayheadClickTimeUs({
    rawTimeUs,
    zoom: zoom.value,
    snapThresholdPx: snapThresholdPx.value,
    toolbarSnapMode: timelineSettingsStore.toolbarSnapMode,
    snapping: workspaceStore.userSettings.timeline.snapping,
    tracks: timelineStore.timelineDoc?.tracks ?? [],
    markers: timelineStore.markers,
    durationUs: timelineEndUs,
    selectionRangeUs: isDraggingSelectionRange.value ? null : timelineStore.selectionRange,
  });
}

function computeSnapTargets(excludeMarkerId?: string) {
  const snapSettings = workspaceStore.userSettings.timeline.snapping;
  const timelineEndUs = Number.isFinite(timelineStore.duration)
    ? Math.max(0, Math.round(timelineStore.duration))
    : null;

  return computeSnapTargetsUs({
    tracks: timelineStore.timelineDoc?.tracks ?? [],
    excludeMarkerId,
    includeTimelineStart: snapSettings.timelineEdges,
    includeTimelineEndUs: snapSettings.timelineEdges ? timelineEndUs : null,
    includePlayheadUs: snapSettings.playhead ? timelineStore.currentTime : null,
    includeMarkers: snapSettings.markers,
    markers: timelineStore.markers,
    includeClips: snapSettings.clips,
    selectionRangeUs:
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

  const timeUs =
    part === 'right' && marker.durationUs !== undefined
      ? marker.timeUs + marker.durationUs
      : marker.timeUs;

  timelineStore.setCurrentTimeUs(timeUs);

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
    timelineStore.setCurrentTimeUs(getTimeUsFromRulerClientEvent(e));
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
  getTimeUsFromPointerEvent: (event) => getTimeUsFromMouseEvent(event),
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
  getTimeUsFromPointerEvent: (event) => getTimeUsFromMouseEvent(event),
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
  lastRightClickTimeUs,
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
  resolvePlayheadClickTimeUs: getSnappedPlayheadTimeUs,
  emit,
});

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
  getRightClickTimeUs: () => lastRightClickTimeUs.value,
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
  timelineStore.setCurrentTimeUs(getSnappedPlayheadTimeUs(getTimeUsFromMouseEvent(event)));
}

function onMobilePointerMove(event: PointerEvent) {
  if (!mobileScrubActive.value) return;
  timelineStore.setCurrentTimeUs(getTimeUsFromMouseEvent(event));
}

function onMobilePointerUp() {
  mobileScrubActive.value = false;
}
</script>

<template>
  <UContextMenu
    :items="rulerContextMenuItems"
    class="w-full h-full"
    @update:open="onContextMenuOpenChange"
  >
    <div
      ref="containerRef"
      data-testid="timeline-ruler"
      class="relative w-full h-full overflow-hidden cursor-pointer"
      :class="isMobile ? '' : 'touch-none'"
      @contextmenu="onRulerContextMenu"
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
</template>
