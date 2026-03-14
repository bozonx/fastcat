<script setup lang="ts">
import { watch, computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { pxToTimeUs } from '~/utils/timeline/geometry';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { useSelectionStore } from '~/stores/selection.store';
import { isSecondaryWheel, DRAG_DEADZONE_PX } from '~/utils/mouse';
import {
  truncateRulerTooltip,
  useTimelineRulerPresentation,
} from '~/composables/timeline/useTimelineRulerPresentation';
import { useTimelineRulerMenus } from '~/composables/timeline/useTimelineRulerMenus';
import { useTimelineRulerMarkerDrag } from '~/composables/timeline/useTimelineRulerMarkerDrag';
import { useTimelineRulerSelectionDrag } from '~/composables/timeline/useTimelineRulerSelectionDrag';
import { useTimelineRulerDraw } from '~/composables/timeline/useTimelineRulerDraw';

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

const middlePointerDown = ref<{ x: number; y: number; moved: boolean } | null>(null);
const pendingSelectAreaEvent = ref<PointerEvent | null>(null);

const rulerSettings = computed(() => workspaceStore.userSettings.mouse.ruler);

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
});

watch([fps, zoom], () => {
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
  if (e && isLayer1Active(e, workspaceStore.userSettings)) {
    executeRulerClickAction(workspaceStore.userSettings.mouse.ruler.shiftClick, e);
    return;
  }
  e?.stopPropagation();
  selectionStore.selectTimelineMarker(markerId);
}

function selectSelectionRange(e?: MouseEvent) {
  if (e && isLayer1Active(e, workspaceStore.userSettings)) {
    executeRulerClickAction(workspaceStore.userSettings.mouse.ruler.shiftClick, e);
    return;
  }
  e?.stopPropagation();
  selectionStore.selectTimelineSelectionRange();
}

const contextClickTimeUs = ref(0);

function onContextMenuOpenChange(val: boolean) {
  if (!val) contextClickTimeUs.value = 0;
}

const { onMarkerPointerDown } = useTimelineRulerMarkerDrag({
  markers,
  zoom,
  selectMarker,
  updateMarker: timelineStore.updateMarker,
});

const {
  isDraggingSelectionRange,
  startSelectionRangeCreate,
  startSelectionRangeDrag,
  suppressNextRulerClick,
} = useTimelineRulerSelectionDrag({
  selectionRange,
  zoom,
  getTimeUsFromPointerEvent: (event) => getTimeUsFromMouseEvent(event as unknown as MouseEvent),
  selectSelectionRange,
  updateSelectionRange: timelineStore.updateSelectionRange,
  createSelectionRange: timelineStore.createSelectionRange,
});

const { markerPoints, selectionRangePoint, currentFrameHighlightStyle, playheadStyle } =
  useTimelineRulerPresentation({
    width,
    scrollLeft,
    zoom,
    fps,
    currentTime,
    markers,
    selectionRange,
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

function getTimeUsFromMouseEvent(e: MouseEvent): number {
  const rect = containerRef.value?.getBoundingClientRect();
  if (!rect) return 0;
  const x = e.clientX - rect.left;
  return pxToTimeUs(scrollLeft.value + x, zoom.value);
}

function onRulerContextMenu(e: MouseEvent) {
  contextClickTimeUs.value = getTimeUsFromMouseEvent(e);
}

// Single click: move playhead or custom action
function onRulerClick(e: MouseEvent) {
  if (e.button !== 0) return;
  if (suppressNextRulerClick.value) {
    suppressNextRulerClick.value = false;
    return;
  }

  const workspaceSettings = workspaceStore.userSettings;
  if (isLayer1Active(e, workspaceSettings)) {
    executeRulerClickAction(workspaceSettings.mouse.ruler.shiftClick, e);
    return;
  }

  executeRulerClickAction(workspaceSettings.mouse.ruler.click, e);
}

// Double click: custom action
function onRulerDblClick(e: MouseEvent) {
  if (e.button !== 0) return;
  const settings = rulerSettings.value;
  executeRulerClickAction(settings.doubleClick, e);
}

// Middle click
function onRulerAuxClick(e: MouseEvent) {
  if (e.button === 1) {
    if (middlePointerDown.value?.moved) {
      middlePointerDown.value = null;
      return;
    }

    middlePointerDown.value = null;
    const settings = rulerSettings.value;
    executeRulerClickAction(settings.middleClick, e);
  }
}

function executeRulerClickAction(action: string, e: PointerEvent | MouseEvent) {
  if (action === 'none') return;

  if (action === 'seek') {
    timelineStore.setCurrentTimeUs(getTimeUsFromMouseEvent(e as MouseEvent));
    return;
  }

  if (action === 'reset_zoom') {
    timelineStore.resetTimelineZoom();
    return;
  }

  if (action === 'select_area') {
    startSelectionRangeCreate(e as PointerEvent);
    return;
  }

  if (action === 'clear_selection') {
    timelineStore.removeSelectionRange();
    timelineStore.clearSelection();
    selectionStore.clearSelection();
    return;
  }

  if (action === 'add_marker') {
    const timeUs = getTimeUsFromMouseEvent(e);
    const newMarkerId = `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    timelineStore.applyTimeline({
      type: 'add_marker',
      id: newMarkerId,
      timeUs,
      text: '',
    });

    selectMarker(newMarkerId);
  }
}

function onRulerPointerDown(e: PointerEvent) {
  if (isDraggingSelectionRange.value) return;
  const settings = rulerSettings.value;

  if (e.button === 1) {
    middlePointerDown.value = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement | null)?.setPointerCapture(e.pointerId);

    // Middle drag behavior
    handleDragAction(settings.middleDrag, e);
    return;
  }

  if (e.button === 0) {
    // Left drag/click behavior
    if (isLayer1Active(e, workspaceStore.userSettings)) {
      handleDragAction(settings.dragShift, e);
    } else {
      handleDragAction(settings.drag, e);
    }
  }
}

function handleDragAction(action: string, e: PointerEvent) {
  if (action === 'pan') {
    emit('start-pan', e);
  } else if (action === 'move_playhead') {
    timelineStore.setCurrentTimeUs(getTimeUsFromMouseEvent(e));
    emit('start-playhead-drag', e);
  } else if (action === 'select_area') {
    pendingSelectAreaEvent.value = e;
  } else if (action === 'none') {
    emit('pointerdown', e);
  }
}

function onRulerPointerMove(e: PointerEvent) {
  if (pendingSelectAreaEvent.value) {
    const origin = pendingSelectAreaEvent.value;
    const dx = e.clientX - origin.clientX;
    const dy = e.clientY - origin.clientY;
    if (Math.abs(dx) > DRAG_DEADZONE_PX || Math.abs(dy) > DRAG_DEADZONE_PX) {
      pendingSelectAreaEvent.value = null;
      startSelectionRangeCreate(origin);
    }
  }

  if (!middlePointerDown.value) return;

  const dx = e.clientX - middlePointerDown.value.x;
  const dy = e.clientY - middlePointerDown.value.y;
  if (Math.abs(dx) > DRAG_DEADZONE_PX || Math.abs(dy) > DRAG_DEADZONE_PX) {
    middlePointerDown.value.moved = true;
  }
}

function onRulerPointerUp() {
  pendingSelectAreaEvent.value = null;
  if (!middlePointerDown.value?.moved) return;
  middlePointerDown.value = null;
}

function onRulerPointerCancel() {
  pendingSelectAreaEvent.value = null;
  middlePointerDown.value = null;
}

function onRulerWheel(e: WheelEvent) {
  const settings = rulerSettings.value;
  const isSecondary = isSecondaryWheel(e);

  const action = isSecondary ? settings.wheelSecondary : settings.wheel;
  if (action === 'none') {
    e.preventDefault();
    return;
  }

  e.preventDefault();
  emit('wheel', e);
}

onMounted(() => {
  containerRef.value?.addEventListener('wheel', onRulerWheel, { passive: false });
});

onBeforeUnmount(() => {
  containerRef.value?.removeEventListener('wheel', onRulerWheel);
});
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
          backgroundColor: 'var(--color-primary-500, #3b82f6)',
          opacity: '0.12',
        }"
      />

      <div
        class="absolute inset-y-0 w-0 pointer-events-none"
        :style="{ ...playheadStyle, willChange: 'transform' }"
      >
        <div
          class="absolute left-0 bottom-0 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-b-0 border-t-10 border-l-transparent border-r-transparent"
          :style="{ borderTopColor: 'var(--color-primary-500, #3b82f6)' }"
        />
        <div
          class="absolute left-0 bottom-0 -translate-x-1/2 w-px h-px"
          :style="{ backgroundColor: 'var(--color-primary-500, #3b82f6)' }"
        />
      </div>

      <div class="absolute inset-0 pointer-events-none">
        <UContextMenu v-if="selectionRangePoint" :items="selectionRangeMenuItems">
          <div
            class="absolute inset-y-0 pointer-events-auto z-30"
            :style="{
              left: `${selectionRangePoint.x}px`,
              width: `${selectionRangePoint.width}px`,
            }"
            @contextmenu.stop
          >
            <button
              type="button"
              class="absolute inset-y-0 left-0 right-0 border-l border-r bg-violet-500/25 border-violet-400/80 shadow-[0_0_0_1px_rgba(167,139,250,0.35)]"
              :class="
                selectionStore.selectedEntity?.source === 'timeline' &&
                selectionStore.selectedEntity?.kind === 'selection-range'
                  ? 'ring-2 ring-violet-300/80'
                  : ''
              "
              @click="selectSelectionRange($event)"
              @pointerdown.stop="startSelectionRangeDrag($event, 'move')"
            />
            <button
              type="button"
              class="absolute inset-y-0 left-0 w-2 -translate-x-1/2 cursor-ew-resize bg-violet-300/70"
              aria-label="Selection start handle"
              @pointerdown.stop="startSelectionRangeDrag($event, 'left')"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-0 w-2 translate-x-1/2 cursor-ew-resize bg-violet-300/70"
              aria-label="Selection end handle"
              @pointerdown.stop="startSelectionRangeDrag($event, 'right')"
            />
          </div>
        </UContextMenu>

        <div
          v-for="p in markerPoints"
          :key="p.id"
          class="absolute bottom-0 h-full pointer-events-auto"
          :style="{ left: `${p.x}px`, width: p.isZone ? `${p.width}px` : 'auto' }"
        >
          <div
            v-if="p.isZone"
            class="absolute inset-y-0 left-0 w-full bg-primary-500/20 border-l border-r border-primary-500/50 pointer-events-none"
            :style="p.color ? { backgroundColor: `${p.color}33`, borderColor: `${p.color}80` } : {}"
          />

          <!-- Left/Main Marker -->
          <div class="absolute bottom-0 left-0">
            <UContextMenu
              :items="p.isZone ? getZoneMarkerMenuItems(p.id) : getMarkerMenuItems(p.id)"
            >
              <UTooltip :text="truncateRulerTooltip(p.text)" :disabled="!p.text">
                <button
                  type="button"
                  class="-translate-x-1 relative z-10"
                  :class="[
                    selectionStore.selectedEntity?.source === 'timeline' &&
                    selectionStore.selectedEntity?.kind === 'marker' &&
                    selectionStore.selectedEntity.markerId === p.id
                      ? p.color
                        ? 'ring-2 ring-white/50'
                        : 'bg-primary-400 ring-2 ring-primary-400/50'
                      : p.color
                        ? ''
                        : 'bg-primary-500',
                  ]"
                  :style="p.color ? { color: p.color } : {}"
                  :aria-label="p.isZone ? 'Zone Marker Start' : 'Marker'"
                  @dblclick.stop.prevent="selectMarker(p.id)"
                  @pointerdown.stop="onMarkerPointerDown($event, p.id)"
                  @contextmenu.stop
                  @click="selectMarker(p.id, $event)"
                >
                  <svg
                    width="10"
                    height="14"
                    viewBox="0 0 10 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M0 0H10V9L5 14L0 9V0Z" :fill="p.color ?? '#3b82f6'" />
                  </svg>
                </button>
              </UTooltip>
            </UContextMenu>
          </div>

          <!-- Right Marker (for zones) -->
          <div v-if="p.isZone" class="absolute bottom-0 right-0">
            <UContextMenu :items="getZoneMarkerMenuItems(p.id)">
              <UTooltip :text="truncateRulerTooltip(p.text)" :disabled="!p.text">
                <button
                  type="button"
                  class="translate-x-1 relative z-10"
                  :class="[
                    selectionStore.selectedEntity?.source === 'timeline' &&
                    selectionStore.selectedEntity?.kind === 'marker' &&
                    selectionStore.selectedEntity.markerId === p.id
                      ? p.color
                        ? 'ring-2 ring-white/50'
                        : 'bg-primary-400 ring-2 ring-primary-400/50'
                      : p.color
                        ? ''
                        : 'bg-primary-500',
                  ]"
                  :style="p.color ? { color: p.color } : {}"
                  aria-label="Zone Marker End"
                  @dblclick.stop.prevent="selectMarker(p.id)"
                  @pointerdown.stop="onMarkerPointerDown($event, p.id, 'right')"
                  @contextmenu.stop
                  @click="selectMarker(p.id, $event)"
                >
                  <svg
                    width="10"
                    height="14"
                    viewBox="0 0 10 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M0 0H10V9L5 14L0 9V0Z" :fill="p.color ?? '#3b82f6'" />
                  </svg>
                </button>
              </UTooltip>
            </UContextMenu>
          </div>
        </div>
      </div>
    </div>
  </UContextMenu>
</template>
