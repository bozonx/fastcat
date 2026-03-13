<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { pxToTimeUs, timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { useResizeObserver } from '@vueuse/core';
import { useSelectionStore } from '~/stores/selection.store';
import { isSecondaryWheel } from '~/utils/mouse';

const { t } = useI18n();

const props = defineProps<{
  scrollEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  (e: 'pointerdown', event: PointerEvent): void;
  (e: 'start-playhead-drag', event: PointerEvent): void;
  (e: 'start-pan', event: PointerEvent): void;
  (e: 'wheel', event: WheelEvent): void;
  (e: 'dblclick-ruler', timeUs: number): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);

const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();

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

let drawRafId: number | null = null;
function scheduleDraw() {
  if (drawRafId !== null) return;
  drawRafId = requestAnimationFrame(() => {
    drawRafId = null;
    draw();
  });
}

let activeMarkerPointerMove: ((e: PointerEvent) => void) | null = null;
let activeMarkerPointerUp: ((e?: PointerEvent) => void) | null = null;

type SelectionDragPart = 'move' | 'left' | 'right';

let activeSelectionPointerMove: ((e: PointerEvent) => void) | null = null;
let activeSelectionPointerUp: ((e?: PointerEvent) => void) | null = null;

function clearMarkerPointerListeners() {
  if (activeMarkerPointerMove) {
    window.removeEventListener('pointermove', activeMarkerPointerMove);
    activeMarkerPointerMove = null;
  }
  if (activeMarkerPointerUp) {
    window.removeEventListener('pointerup', activeMarkerPointerUp as any);
    activeMarkerPointerUp = null;
  }
}

function clearSelectionPointerListeners() {
  if (activeSelectionPointerMove) {
    window.removeEventListener('pointermove', activeSelectionPointerMove);
    activeSelectionPointerMove = null;
  }
  if (activeSelectionPointerUp) {
    window.removeEventListener('pointerup', activeSelectionPointerUp as any);
    activeSelectionPointerUp = null;
  }
}

onMounted(() => {
  // Theme override removed to favor manual adjustment above
});

// Always read width from own container to match canvas CSS dimensions exactly.
// Using scrollEl width causes canvas stretching when a vertical scrollbar is present,
// because scrollEl.contentRect.width < container CSS width.
useResizeObserver(containerRef, (entries) => {
  const entry = entries[0];
  if (entry) {
    width.value = entry.contentRect.width;
    height.value = entry.contentRect.height;
    scheduleDraw();
  }
});

function onScroll() {
  if (props.scrollEl) {
    scrollLeft.value = props.scrollEl.scrollLeft;
    if (drawRafId !== null) {
      cancelAnimationFrame(drawRafId);
      drawRafId = null;
    }
    draw();
  }
}

watch(
  () => props.scrollEl,
  (el, oldEl) => {
    if (oldEl) {
      oldEl.removeEventListener('scroll', onScroll);
    }
    if (el) {
      el.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (props.scrollEl) {
    props.scrollEl.removeEventListener('scroll', onScroll);
  }

  clearMarkerPointerListeners();
  clearSelectionPointerListeners();
  if (drawRafId !== null) {
    cancelAnimationFrame(drawRafId);
    drawRafId = null;
  }
});

const fps = computed(() => projectStore.projectSettings.project.fps || 30);
const zoom = computed(() => timelineStore.timelineZoom);
const currentTime = computed(() => timelineStore.currentTime);

watch([fps, zoom, width, height, scrollLeft], () => {
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

function selectMarker(markerId: string) {
  selectionStore.selectTimelineMarker(markerId);
}

function selectSelectionRange() {
  selectionStore.selectTimelineSelectionRange();
}

const draggedMarkerId = ref<string | null>(null);
const draggedMarkerPart = ref<'left' | 'right'>('left');
const markerDragStartX = ref(0);
const markerDragStartUs = ref(0);
const markerDragStartDurationUs = ref(0);

const isDraggingSelectionRange = ref(false);
const selectionDragPart = ref<SelectionDragPart>('move');
const selectionDragStartX = ref(0);
const selectionDragStartStartUs = ref(0);
const selectionDragStartEndUs = ref(0);
const suppressNextRulerClick = ref(false);
const isCreatingSelectionRange = ref(false);
const selectionCreateStartUs = ref(0);

const contextClickTimeUs = ref(0);

function onContextMenuOpenChange(val: boolean) {
  if (!val) contextClickTimeUs.value = 0;
}

function onMarkerContextMenu(e: MouseEvent, markerId: string) {
  e.preventDefault();
  selectMarker(markerId);
}

function onMarkerPointerDown(e: PointerEvent, markerId: string, part: 'left' | 'right' = 'left') {
  if (e.button !== 0) return;
  e.stopPropagation();
  selectMarker(markerId);

  const m = markers.value.find((x) => x.id === markerId);
  if (!m) return;

  draggedMarkerId.value = markerId;
  draggedMarkerPart.value = part;
  markerDragStartX.value = e.clientX;
  markerDragStartUs.value = m.timeUs;
  markerDragStartDurationUs.value = m.durationUs ?? 0;

  clearMarkerPointerListeners();
  activeMarkerPointerMove = onWindowPointerMove;
  activeMarkerPointerUp = onWindowPointerUp;
  window.addEventListener('pointermove', onWindowPointerMove);
  window.addEventListener('pointerup', onWindowPointerUp);
}

function onWindowPointerMove(e: PointerEvent) {
  if (!draggedMarkerId.value) return;

  const dx = e.clientX - markerDragStartX.value;
  const currentZoom = zoom.value;

  if (draggedMarkerPart.value === 'left') {
    const startPx = timeUsToPx(markerDragStartUs.value, currentZoom);
    const newPx = Math.max(0, startPx + dx);
    const newUs = Math.max(0, pxToTimeUs(newPx, currentZoom));

    // If it's a zone, adjusting left should keep the right edge fixed by changing duration
    const m = markers.value.find((x) => x.id === draggedMarkerId.value);
    if (m && m.durationUs !== undefined) {
      const endUs = markerDragStartUs.value + markerDragStartDurationUs.value;
      if (newUs < endUs) {
        timelineStore.updateMarker(draggedMarkerId.value, {
          timeUs: newUs,
          durationUs: endUs - newUs,
        });
      }
    } else {
      timelineStore.updateMarker(draggedMarkerId.value, { timeUs: newUs });
    }
  } else if (draggedMarkerPart.value === 'right') {
    const durationPx = timeUsToPx(markerDragStartDurationUs.value, currentZoom);
    const newDurationPx = Math.max(10, durationPx + dx); // min width 10px
    const newDurationUs = pxToTimeUs(newDurationPx, currentZoom);

    timelineStore.updateMarker(draggedMarkerId.value, { durationUs: newDurationUs });
  }
}

function onWindowPointerUp() {
  draggedMarkerId.value = null;
  clearMarkerPointerListeners();
}

function updateSelectionRangeFromDrag(clientX: number) {
  const range = selectionRange.value;
  if (!range) return;

  const dx = clientX - selectionDragStartX.value;
  const deltaUs = pxToTimeUs(Math.abs(dx), zoom.value) * (dx < 0 ? -1 : 1);
  const minDurationUs = Math.max(1, pxToTimeUs(6, zoom.value));

  if (selectionDragPart.value === 'move') {
    const durationUs = selectionDragStartEndUs.value - selectionDragStartStartUs.value;
    const nextStartUs = Math.max(0, Math.round(selectionDragStartStartUs.value + deltaUs));
    timelineStore.updateSelectionRange({
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
    timelineStore.updateSelectionRange({
      startUs: nextStartUs,
      endUs: selectionDragStartEndUs.value,
    });
    return;
  }

  const nextEndUs = Math.max(
    selectionDragStartStartUs.value + minDurationUs,
    Math.round(selectionDragStartEndUs.value + deltaUs),
  );
  timelineStore.updateSelectionRange({
    startUs: selectionDragStartStartUs.value,
    endUs: nextEndUs,
  });
}

function onSelectionPointerMove(e: PointerEvent) {
  if (!isDraggingSelectionRange.value) return;
  suppressNextRulerClick.value = true;
  updateSelectionRangeFromDrag(e.clientX);
}

function onSelectionPointerUp() {
  isDraggingSelectionRange.value = false;
  window.setTimeout(() => {
    suppressNextRulerClick.value = false;
  }, 0);
  clearSelectionPointerListeners();
}

function startSelectionRangeDrag(e: PointerEvent, part: SelectionDragPart) {
  if (e.button !== 0 || !selectionRange.value) return;
  e.stopPropagation();
  e.preventDefault();

  selectSelectionRange();
  isDraggingSelectionRange.value = true;
  selectionDragPart.value = part;
  selectionDragStartX.value = e.clientX;
  selectionDragStartStartUs.value = selectionRange.value.startUs;
  selectionDragStartEndUs.value = selectionRange.value.endUs;
  suppressNextRulerClick.value = part !== 'move';

  clearSelectionPointerListeners();
  activeSelectionPointerMove = onSelectionPointerMove;
  activeSelectionPointerUp = onSelectionPointerUp;
  window.addEventListener('pointermove', onSelectionPointerMove);
  window.addEventListener('pointerup', onSelectionPointerUp);
}

function onSelectionCreatePointerMove(e: PointerEvent) {
  if (!isCreatingSelectionRange.value) return;

  suppressNextRulerClick.value = true;
  const currentUs = getTimeUsFromMouseEvent(e as unknown as MouseEvent);
  const startUs = Math.min(selectionCreateStartUs.value, currentUs);
  const endUs = Math.max(selectionCreateStartUs.value, currentUs);

  timelineStore.createSelectionRange({
    startUs,
    endUs: Math.max(startUs + 1, endUs),
  });
}

function onSelectionCreatePointerUp() {
  isCreatingSelectionRange.value = false;
  clearSelectionPointerListeners();
  window.setTimeout(() => {
    suppressNextRulerClick.value = false;
  }, 0);
}

function startSelectionRangeCreate(e: PointerEvent) {
  if (e.button !== 0) return;

  e.preventDefault();
  e.stopPropagation();

  const timeUs = getTimeUsFromMouseEvent(e as unknown as MouseEvent);
  selectionCreateStartUs.value = timeUs;
  isCreatingSelectionRange.value = true;

  timelineStore.createSelectionRange({
    startUs: timeUs,
    endUs: timeUs + 1,
  });

  clearSelectionPointerListeners();
  activeSelectionPointerMove = onSelectionCreatePointerMove;
  activeSelectionPointerUp = onSelectionCreatePointerUp;
  window.addEventListener('pointermove', onSelectionCreatePointerMove);
  window.addEventListener('pointerup', onSelectionCreatePointerUp);
}

function truncateForTooltip(text: string): string {
  const t = String(text ?? '');
  const singleLine = t.replace(/\s+/g, ' ').trim();
  if (!singleLine) return '';
  const max = 160;
  return singleLine.length > max ? `${singleLine.slice(0, max)}…` : singleLine;
}

const markerPoints = computed(() => {
  const currentZoom = zoom.value;
  const startPx = scrollLeft.value;
  const w = width.value;

  return markers.value
    .map((m) => {
      const x = timeUsToPx(m.timeUs, currentZoom) - startPx;
      const width = m.durationUs !== undefined ? timeUsToPx(m.durationUs, currentZoom) : 0;
      return {
        id: m.id,
        x,
        width,
        isZone: m.durationUs !== undefined,
        text: m.text ?? '',
        color: m.color ?? '#eab308',
      };
    })
    .filter(
      (p) => (p.x >= -20 && p.x <= w + 20) || (p.isZone && p.x + p.width >= -20 && p.x <= w + 20),
    );
});

const selectionRangePoint = computed(() => {
  const range = selectionRange.value;
  if (!range) return null;

  const currentZoom = zoom.value;
  const startPx = scrollLeft.value;
  const x = timeUsToPx(range.startUs, currentZoom) - startPx;
  const width = Math.max(1, timeUsToPx(range.endUs - range.startUs, currentZoom));

  return {
    x,
    width,
  };
});

const currentFrameHighlightStyle = computed(() => {
  const currentZoom = zoom.value;
  const currentFps = fps.value;
  const pxPerFrame = zoomToPxPerSecond(currentZoom) / currentFps;
  if (pxPerFrame < 6) return null;

  const frameDurationUs = 1_000_000 / currentFps;
  const currentFrameStartUs = Math.floor(currentTime.value / frameDurationUs) * frameDurationUs;
  const currentFrameStartX = timeUsToPx(currentFrameStartUs, currentZoom) - scrollLeft.value;

  return {
    transform: `translate3d(${currentFrameStartX}px, 0, 0)`,
    width: `${pxPerFrame}px`,
  };
});

const playheadStyle = computed(() => {
  const playheadX = Math.round(timeUsToPx(currentTime.value, zoom.value) - scrollLeft.value);

  return {
    transform: `translate3d(${playheadX}px, 0, 0)`,
  };
});

function formatTime(us: number, fpsValue: number): string {
  const totalFrames = Math.round((us / 1_000_000) * fpsValue);
  const ff = totalFrames % fpsValue;
  const totalSeconds = Math.floor(us / 1_000_000);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = width.value;
  const h = height.value;

  if (w === 0 || h === 0) return;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  const currentZoom = zoom.value;
  const currentFps = fps.value;
  const pxPerSec = zoomToPxPerSecond(currentZoom);
  const pxPerFrame = pxPerSec / currentFps;

  const startPx = scrollLeft.value;
  const endPx = startPx + w;
  const startUs = pxToTimeUs(startPx, currentZoom);
  const endUs = pxToTimeUs(endPx, currentZoom);

  const MIN_DIST_PX = 90;
  const timeStepsS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  let mainStepS = timeStepsS[timeStepsS.length - 1]!;
  for (const step of timeStepsS) {
    if (step * pxPerSec >= MIN_DIST_PX) {
      mainStepS = step;
      break;
    }
  }

  ctx.fillStyle = textColor;
  ctx.strokeStyle = tickColor;
  ctx.lineWidth = majorTickWidth;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const startS = Math.floor(startUs / 1_000_000 / mainStepS) * mainStepS;
  const endS = Math.ceil(endUs / 1_000_000);

  ctx.beginPath();
  for (let s = startS; s <= endS; s += mainStepS) {
    const x = Math.round(timeUsToPx(s * 1_000_000, currentZoom) - startPx) + 0.5;

    if (x >= -50 && x <= w + 50) {
      ctx.moveTo(x, h - 12);
      ctx.lineTo(x, h);
      ctx.fillText(formatTime(s * 1_000_000, currentFps), x, 4);
    }
  }
  ctx.stroke();

  // Draw sub-ticks and frame lines (thinner)
  ctx.lineWidth = subTickWidth;
  ctx.beginPath();

  for (let s = startS; s <= endS; s += mainStepS) {
    if (mainStepS === 1) {
      let frameStep = 1;
      if (pxPerFrame < 5) {
        frameStep = Math.ceil(5 / pxPerFrame);
      }

      for (let f = 1; f < currentFps; f += frameStep) {
        const frameX =
          Math.round(
            timeUsToPx(s * 1_000_000 + (f * 1_000_000) / currentFps, currentZoom) - startPx,
          ) + 0.5;
        if (frameX >= -50 && frameX <= w + 50) {
          ctx.moveTo(frameX, h - 5);
          ctx.lineTo(frameX, h);
        }
      }
    } else {
      let subStepS = 1;
      if (mainStepS >= 60) subStepS = 10;
      else if (mainStepS >= 10) subStepS = 5;
      else if (mainStepS >= 5) subStepS = 1;

      for (let sub = s + subStepS; sub < s + mainStepS; sub += subStepS) {
        const subX = Math.round(timeUsToPx(sub * 1_000_000, currentZoom) - startPx) + 0.5;
        if (subX >= -50 && subX <= w + 50) {
          ctx.moveTo(subX, h - 5);
          ctx.lineTo(subX, h);
        }
      }
    }
  }
  ctx.stroke();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function getTimeUsFromMouseEvent(e: MouseEvent): number {
  const rect = containerRef.value?.getBoundingClientRect();
  if (!rect) return 0;
  const x = e.clientX - rect.left;
  return pxToTimeUs(scrollLeft.value + x, zoom.value);
}

function onRulerContextMenu(e: MouseEvent) {
  contextClickTimeUs.value = getTimeUsFromMouseEvent(e);
}

// Single click: move playhead
function onRulerClick(e: MouseEvent) {
  if (e.button !== 0) return;
  if (suppressNextRulerClick.value) {
    suppressNextRulerClick.value = false;
    return;
  }
  timelineStore.setCurrentTimeUs(getTimeUsFromMouseEvent(e));
}

// Double click: add marker at clicked position
function onRulerDblClick(e: MouseEvent) {
  if (e.button !== 0) return;

  const settings = useWorkspaceStore().userSettings.mouse.ruler;
  if (settings.doubleClick === 'none') return;

  if (settings.doubleClick === 'add_marker') {
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
  const settings = useWorkspaceStore().userSettings.mouse.ruler;

  if (e.button === 1) {
    // Middle click
    if (settings.middleClick === 'pan') {
      emit('start-pan', e);
      return;
    }
    if (settings.middleClick === 'move_playhead') {
      timelineStore.setCurrentTimeUs(getTimeUsFromMouseEvent(e));
      emit('start-playhead-drag', e); // Pass to Timeline to trigger drag playhead
      return;
    }
  } else if (e.button === 0) {
    // Left click
    if (isLayer1Active(e, useWorkspaceStore().userSettings)) {
      startSelectionRangeCreate(e);
      return;
    }

    if (settings.drag === 'pan') {
      emit('start-pan', e); // This will trigger pan in Timeline
    } else if (settings.drag === 'move_playhead') {
      timelineStore.setCurrentTimeUs(getTimeUsFromMouseEvent(e));
      emit('start-playhead-drag', e); // This will trigger startPlayheadDrag
    } else {
      emit('pointerdown', e); // default behavior
    }
  }
}

function onRulerWheel(e: WheelEvent) {
  const settings = useWorkspaceStore().userSettings.mouse.ruler;
  const isSecondary = isSecondaryWheel(e);

  const action = isSecondary ? settings.wheelSecondary : settings.wheel;
  if (action === 'none') {
    e.preventDefault();
    return;
  }

  e.preventDefault();
  emit('wheel', e);
}

const rulerContextMenuItems = computed(() => [
  [
    {
      label: t('fastcat.timeline.addMarkerAtPlayhead', 'Add marker at playhead'),
      icon: 'i-heroicons-bookmark',
      onSelect: () => {
        timelineStore.addMarkerAtPlayhead();
        const latest = timelineStore.getMarkers().at(-1);
        if (latest) selectMarker(latest.id);
      },
    },
    {
      label: t('fastcat.timeline.addZoneMarkerAtPlayhead', 'Add zone marker at playhead'),
      icon: 'i-heroicons-arrows-right-left',
      onSelect: () => {
        timelineStore.addZoneMarkerAtPlayhead();
        const latest = timelineStore.getMarkers().at(-1);
        if (latest) selectMarker(latest.id);
      },
    },
    {
      label: t('fastcat.timeline.createSelectionArea', 'Create selection area'),
      icon: 'i-heroicons-rectangle-group',
      onSelect: () => {
        timelineStore.createSelectionRangeAtPlayhead();
      },
    },
  ],
]);

function getZoneMarkerMenuItems(markerId: string) {
  return [
    [
      {
        label: t('fastcat.timeline.convertZoneToMarker', 'Convert to normal marker'),
        icon: 'i-heroicons-arrows-pointing-in',
        onSelect: () => timelineStore.convertZoneToMarker(markerId),
      },
      {
        label: t('fastcat.timeline.convertZoneToSelection', 'Convert to selection area'),
        icon: 'i-heroicons-rectangle-group',
        onSelect: () => timelineStore.convertMarkerToSelectionRange(markerId),
      },
      {
        label: t('fastcat.timeline.createSelectionFromZone', 'Create selection area'),
        icon: 'i-heroicons-sparkles',
        onSelect: () => timelineStore.createSelectionRangeFromMarker(markerId),
      },
      {
        label: t('fastcat.timeline.deleteMarker', 'Delete marker'),
        icon: 'i-heroicons-trash',
        color: 'red' as const,
        onSelect: () => deleteMarker(markerId),
      },
    ],
  ];
}

function getMarkerMenuItems(markerId: string) {
  return [
    [
      {
        label: t('fastcat.timeline.convertMarkerToZone', 'Convert to zone marker'),
        icon: 'i-heroicons-arrows-pointing-out',
        onSelect: () => timelineStore.convertMarkerToZone(markerId),
      },
      {
        label: t('fastcat.timeline.deleteMarker', 'Delete marker'),
        icon: 'i-heroicons-trash',
        color: 'red' as const,
        onSelect: () => deleteMarker(markerId),
      },
    ],
  ];
}

const selectionRangeMenuItems = computed(() => [
  [
    {
      label: t('fastcat.timeline.convertSelectionToZoneMarker', 'Convert to zone marker'),
      icon: 'i-heroicons-bookmark-square',
      onSelect: () => timelineStore.convertSelectionRangeToMarker(),
    },
    {
      label: t('fastcat.timeline.rippleTrimSelection', 'Ripple trim selection'),
      icon: 'i-heroicons-scissors',
      onSelect: () => timelineStore.rippleTrimSelectionRange(),
    },
    {
      label: t('common.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      color: 'red' as const,
      onSelect: () => timelineStore.removeSelectionRange(),
    },
  ],
]);
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
      @pointerdown="onRulerPointerDown"
      @wheel.prevent="onRulerWheel"
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
          class="absolute left-0 bottom-0 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-b-0 border-t-[10px] border-l-transparent border-r-transparent"
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
              @click.stop="selectSelectionRange"
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
              <UTooltip :text="truncateForTooltip(p.text)" :disabled="!p.text">
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
                  @click.stop="selectMarker(p.id)"
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
              <UTooltip :text="truncateForTooltip(p.text)" :disabled="!p.text">
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
                  @click.stop="selectMarker(p.id)"
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
