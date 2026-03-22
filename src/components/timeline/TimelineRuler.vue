<script setup lang="ts">
import { watch, computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { useSelectionStore } from '~/stores/selection.store';
import {
  truncateRulerTooltip,
  useTimelineRulerPresentation,
} from '~/composables/timeline/useTimelineRulerPresentation';
import { useTimelineRulerMenus } from '~/composables/timeline/useTimelineRulerMenus';
import { useTimelineRulerMarkerDrag } from '~/composables/timeline/useTimelineRulerMarkerDrag';
import { useTimelineRulerSelectionDrag } from '~/composables/timeline/useTimelineRulerSelectionDrag';
import { useTimelineRulerDraw } from '~/composables/timeline/useTimelineRulerDraw';
import { useTimelineRulerInteractions } from '~/composables/timeline/useTimelineRulerInteractions';
import { computeSnapTargetsUs } from '~/composables/timeline/timelineInteractionUtils';

const { t } = useI18n();

const props = defineProps<{
  scrollEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  (e: 'pointerdown' | 'start-playhead-drag' | 'start-pan', event: PointerEvent): void;
  (e: 'wheel', event: WheelEvent): void;
  (e: 'dblclick-ruler', timeUs: number): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);

const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();
const workspaceStore = useWorkspaceStore();

const width = ref(0);
const height = ref(0);
const scrollLeft = ref(0);

const markers = computed(() => timelineStore.getMarkers());
const selectionRange = computed(() => timelineStore.getSelectionRange());

// --- Styling Settings (Adjust these for desired look) ---
const textColor = 'rgba(255, 255, 255, 0.5)';
const tickColor = 'rgba(255, 255, 255, 0.2)';
const majorTickWidth = 1.25;
const subTickWidth = 0.8;
// ---------------------------------------------------------

const fps = computed(() => projectStore.projectSettings.project.fps || 30);
const zoom = computed(() => timelineStore.timelineZoom);
const currentTime = computed(() => timelineStore.currentTime);

const snapThresholdPx = computed(() => workspaceStore.userSettings.timeline.snapThresholdPx);

function computeSnapTargets() {
  const snapSettings = workspaceStore.userSettings.timeline.snapping;
  const timelineEndUs = Number.isFinite(timelineStore.duration)
    ? Math.max(0, Math.round(timelineStore.duration))
    : null;

  return computeSnapTargetsUs({
    tracks: timelineStore.timelineDoc?.tracks ?? [],
    includeTimelineStart: snapSettings.timelineEdges,
    includeTimelineEndUs: snapSettings.timelineEdges ? timelineEndUs : null,
    includePlayheadUs: snapSettings.playhead ? timelineStore.currentTime : null,
    includeMarkers: snapSettings.markers,
    markers: timelineStore.getMarkers(),
    includeClips: snapSettings.clips,
    selectionRangeUs: snapSettings.selection ? timelineStore.getSelectionRange() : null,
  });
}

const { scheduleDraw } = useTimelineRulerDraw({
  containerRef,
  canvasRef,
  scrollEl: computed(() => props.scrollEl),
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

function selectMarker(markerId: string, e?: MouseEvent, part: 'left' | 'right' = 'left', movePlayhead = true) {
  if (e && isLayer1Active(e, workspaceStore.userSettings)) {
    executeRulerClickAction(workspaceStore.userSettings.mouse.ruler.shiftClick, e);
    return;
  }
  e?.stopPropagation();
  selectionStore.selectTimelineMarker(markerId);

  if (!movePlayhead) return;

  const marker = timelineStore.getMarkers().find((m) => m.id === markerId);
  if (marker) {
    if (part === 'right' && marker.durationUs !== undefined) {
      timelineStore.setCurrentTimeUs(marker.timeUs + marker.durationUs);
    } else {
      timelineStore.setCurrentTimeUs(marker.timeUs);
    }
  }
}

function selectSelectionRange(e?: MouseEvent) {
  if (e && isLayer1Active(e, workspaceStore.userSettings)) {
    executeRulerClickAction(workspaceStore.userSettings.mouse.ruler.shiftClick, e);
    return;
  }
  e?.stopPropagation();
  selectionStore.selectTimelineSelectionRange();
}

const { onMarkerPointerDown, displayMarkers, draggedMarkerId } = useTimelineRulerMarkerDrag({
  markers,
  zoom,
  fps,
  selectMarker,
  updateMarker: timelineStore.updateMarker,
  computeSnapTargets,
  snapThresholdPx: computed(() => snapThresholdPx.value),
});

const {
  isDraggingSelectionRange,
  isCreatingSelectionRange,
  startSelectionRangeDrag,
  startSelectionRangeCreate,
  suppressNextRulerClick,
  displaySelectionRange,
} = useTimelineRulerSelectionDrag({
  selectionRange,
  zoom,
  fps,
  getTimeUsFromPointerEvent: (event) => getTimeUsFromMouseEvent(event as unknown as MouseEvent),
  selectSelectionRange,
  updateSelectionRange: timelineStore.updateSelectionRange,
  createSelectionRange: timelineStore.createSelectionRange,
  setPreviewSelectionRange: timelineStore.setPreviewSelectionRange,
  computeSnapTargets,
  snapThresholdPx,
});

const hoveredMarkerId = ref<string | null>(null);

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
  emit,
});

const isSelectionRangeSelected = computed(
  () =>
    selectionStore.selectedEntity?.source === 'timeline' &&
    selectionStore.selectedEntity?.kind === 'selection-range',
);

function isMarkerSelected(markerId: string) {
  return (
    selectionStore.selectedEntity?.source === 'timeline' &&
    selectionStore.selectedEntity?.kind === 'marker' &&
    selectionStore.selectedEntity.markerId === markerId
  );
}
</script>

<template>
  <UContextMenu
    :items="rulerContextMenuItems"
    class="w-full"
    @update:open="onContextMenuOpenChange"
  >
    <div
      ref="containerRef"
      class="relative w-full overflow-hidden cursor-pointer"
      @contextmenu="onRulerContextMenu"
      @click="onRulerClick"
      @dblclick="onRulerDblClick"
      @auxclick="onRulerAuxClick"
      @pointerdown="onRulerPointerDown"
      @pointermove="onRulerPointerMove"
      @pointerup="onRulerPointerUp"
      @pointercancel="onRulerPointerCancel"
    >
      <canvas ref="canvasRef" class="absolute top-0 left-0 w-full h-full pointer-events-none" />

      <div
        v-if="currentFrameHighlightStyle"
        class="absolute inset-y-0 pointer-events-none"
        :style="{
          ...currentFrameHighlightStyle,
          willChange: 'transform',
          backgroundColor: 'var(--color-primary-500, #71717a)',
          opacity: '0.12',
        }"
      />

      <div
        class="absolute inset-y-0 w-0 pointer-events-none"
        :style="{ ...playheadStyle, willChange: 'transform' }"
      >
        <div
          class="absolute left-0 bottom-0 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-b-0 border-t-10 border-l-transparent border-r-transparent"
          :style="{ borderTopColor: 'var(--color-primary-500, #71717a)' }"
        />
        <div
          class="absolute left-0 bottom-0 -translate-x-1/2 w-px h-px"
          :style="{ backgroundColor: 'var(--color-primary-500, #71717a)' }"
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
        @select-marker="selectMarker"
        @marker-pointerdown="onMarkerPointerDown"
        @select-selection-range="selectSelectionRange"
        @selection-range-pointerdown="startSelectionRangeDrag"
      />
    </div>
  </UContextMenu>
</template>
