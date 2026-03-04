<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { pxToTimeUs, timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';
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

let textColor = '#8a8a8a';
let tickColor = '#4a4a4a';

onMounted(() => {
  const styles = window.getComputedStyle(document.documentElement);
  const tc = styles.getPropertyValue('--ui-text-muted').trim();
  const bc = styles.getPropertyValue('--ui-border').trim();
  if (tc) textColor = tc;
  if (bc) tickColor = bc;
});

useResizeObserver(containerRef, (entries) => {
  const entry = entries[0];
  if (entry) {
    height.value = entry.contentRect.height;
    if (!props.scrollEl) {
      width.value = entry.contentRect.width;
      draw();
    }
  }
});

function onScroll() {
  if (props.scrollEl) {
    scrollLeft.value = props.scrollEl.scrollLeft;
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

useResizeObserver(
  () => props.scrollEl,
  (entries) => {
    const entry = entries[0];
    if (entry) {
      width.value = entry.contentRect.width;
      draw();
    }
  },
);

onUnmounted(() => {
  if (props.scrollEl) {
    props.scrollEl.removeEventListener('scroll', onScroll);
  }
});

const fps = computed(() => projectStore.projectSettings.project.fps || 30);
const zoom = computed(() => timelineStore.timelineZoom);
const currentTime = computed(() => timelineStore.currentTime);

watch([fps, zoom, width, height, scrollLeft, currentTime], () => {
  requestAnimationFrame(draw);
});

watch(markers, () => {
  requestAnimationFrame(draw);
});

function deleteMarker(markerId: string) {
  timelineStore.removeMarker(markerId);
}

function selectMarker(markerId: string) {
  selectionStore.selectTimelineMarker(markerId);
}

const draggedMarkerId = ref<string | null>(null);
const draggedMarkerPart = ref<'left' | 'right'>('left');
const markerDragStartX = ref(0);
const markerDragStartUs = ref(0);
const markerDragStartDurationUs = ref(0);

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
    const m = markers.value.find(x => x.id === draggedMarkerId.value);
    if (m && m.durationUs !== undefined) {
      const endUs = markerDragStartUs.value + markerDragStartDurationUs.value;
      if (newUs < endUs) {
        timelineStore.updateMarker(draggedMarkerId.value, { 
          timeUs: newUs,
          durationUs: endUs - newUs
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
  window.removeEventListener('pointermove', onWindowPointerMove);
  window.removeEventListener('pointerup', onWindowPointerUp);
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
    .filter((p) => (p.x >= -20 && p.x <= w + 20) || (p.isZone && p.x + p.width >= -20 && p.x <= w + 20));
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
  ctx.lineWidth = 1.5;
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

    if (mainStepS === 1) {
      const pxPerFrame = pxPerSec / currentFps;
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

  // Playhead indicator in ruler
  // Use Math.round without +0.5 offset to match the CSS playhead line pixel position
  const playheadX = Math.round(timeUsToPx(currentTime.value, currentZoom) - startPx);
  if (playheadX >= -10 && playheadX <= w + 10) {
    const styles = window.getComputedStyle(document.documentElement);
    const primaryColor = styles.getPropertyValue('--color-primary-500').trim() || '#3b82f6';

    ctx.beginPath();
    ctx.fillStyle = primaryColor;

    const pw = 10;
    const ph = 10;

    // Triangle pointing down, touching the bottom edge of the ruler
    ctx.moveTo(playheadX - pw / 2, h - ph);
    ctx.lineTo(playheadX + pw / 2, h - ph);
    ctx.lineTo(playheadX, h);
    ctx.fill();

    // Draw a 1px vertical line from triangle tip to bottom edge for precise alignment
    ctx.fillRect(playheadX, h - 1, 1, 1);
  }

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
  timelineStore.currentTime = getTimeUsFromMouseEvent(e);
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
  const settings = useWorkspaceStore().userSettings.mouse.ruler;

  if (e.button === 1) { // Middle click
    if (settings.middleClick === 'pan') {
      emit('start-pan', e);
      return;
    }
    if (settings.middleClick === 'move_playhead') {
      timelineStore.currentTime = getTimeUsFromMouseEvent(e);
      emit('start-playhead-drag', e); // Pass to Timeline to trigger drag playhead
      return;
    }
  } else if (e.button === 0) { // Left click
    if (e.shiftKey) {
      if (settings.shiftClick === 'add_marker_and_edit') {
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
      return;
    }

    if (settings.drag === 'pan') {
      emit('start-pan', e); // This will trigger pan in Timeline
    } else if (settings.drag === 'move_playhead') {
      timelineStore.currentTime = getTimeUsFromMouseEvent(e);
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
</script>

<template>
  <UContextMenu
    :items="[
      [
        {
          label: t('granVideoEditor.timeline.addMarkerAtPlayhead', 'Add marker at playhead'),
          icon: 'i-heroicons-bookmark',
          onSelect: () => {
            const timeUs = currentTime;
            const newMarkerId = `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            timelineStore.applyTimeline({
              type: 'add_marker',
              id: newMarkerId,
              timeUs,
              text: '',
            });
            selectMarker(newMarkerId);
          },
        },
        {
          label: t(
            'granVideoEditor.timeline.addZoneMarkerAtPlayhead',
            'Add zone marker at playhead',
          ),
          icon: 'i-heroicons-arrows-right-left',
          onSelect: () => {
            const timeUs = currentTime;
            const newMarkerId = `marker_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            timelineStore.applyTimeline({
              type: 'add_marker',
              id: newMarkerId,
              timeUs,
              durationUs: 5_000_000,
              text: '',
            });
            selectMarker(newMarkerId);
          },
        },
      ],
    ]"
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

      <div class="absolute inset-0 pointer-events-none">
        <div
          v-for="p in markerPoints"
          :key="p.id"
          class="absolute bottom-0 h-full pointer-events-auto"
          :style="{ left: `${p.x}px`, width: p.isZone ? `${p.width}px` : 'auto' }"
        >
          <div v-if="p.isZone" class="absolute inset-y-0 left-0 w-full bg-primary-500/20 border-l border-r border-primary-500/50 pointer-events-none" :style="p.color ? { backgroundColor: `${p.color}33`, borderColor: `${p.color}80` } : {}" />
          
          <!-- Left/Main Marker -->
          <div class="absolute bottom-0 left-0">
            <UContextMenu
              :items="
                p.isZone
                  ? [
                      [
                        {
                          label: t(
                            'granVideoEditor.timeline.convertZoneToMarker',
                            'Convert to normal marker',
                          ),
                          icon: 'i-heroicons-arrows-pointing-in',
                          onSelect: () => timelineStore.convertZoneToMarker(p.id),
                        },
                        {
                          label: t('granVideoEditor.timeline.deleteMarker', 'Delete marker'),
                          icon: 'i-heroicons-trash',
                          color: 'red',
                          onSelect: () => deleteMarker(p.id),
                        },
                      ],
                    ]
                  : [
                      [
                        {
                          label: t(
                            'granVideoEditor.timeline.convertMarkerToZone',
                            'Convert to zone marker',
                          ),
                          icon: 'i-heroicons-arrows-pointing-out',
                          onSelect: () => timelineStore.convertMarkerToZone(p.id),
                        },
                        {
                          label: t('granVideoEditor.timeline.deleteMarker', 'Delete marker'),
                          icon: 'i-heroicons-trash',
                          color: 'red',
                          onSelect: () => deleteMarker(p.id),
                        },
                      ],
                    ]
              "
            >
              <UTooltip :text="truncateForTooltip(p.text)" :disabled="!p.text">
                <button
                  type="button"
                  class="-translate-x-1 relative z-10"
                  :class="[
                    selectionStore.selectedEntity?.source === 'timeline' &&
                    selectionStore.selectedEntity?.kind === 'marker' &&
                    selectionStore.selectedEntity.markerId === p.id
                      ? (p.color ? 'ring-2 ring-white/50' : 'bg-primary-400 ring-2 ring-primary-400/50')
                      : (p.color ? '' : 'bg-primary-500'),
                  ]"
                  :style="p.color ? { color: p.color } : {}"
                  :aria-label="p.isZone ? 'Zone Marker Start' : 'Marker'"
                  @dblclick.stop.prevent="selectMarker(p.id)"
                  @pointerdown.stop="onMarkerPointerDown($event, p.id)"
                  @contextmenu.stop
                  @click.stop="selectMarker(p.id)"
                >
                  <svg width="10" height="14" viewBox="0 0 10 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0 0H10V9L5 14L0 9V0Z" :fill="p.color ?? '#3b82f6'" />
                  </svg>
                </button>
              </UTooltip>
            </UContextMenu>
          </div>
          
          <!-- Right Marker (for zones) -->
          <div v-if="p.isZone" class="absolute bottom-0 right-0">
            <UContextMenu
              :items="[
                [
                  {
                    label: t(
                      'granVideoEditor.timeline.convertZoneToMarker',
                      'Convert to normal marker',
                    ),
                    icon: 'i-heroicons-arrows-pointing-in',
                    onSelect: () => timelineStore.convertZoneToMarker(p.id),
                  },
                  {
                    label: t('granVideoEditor.timeline.deleteMarker', 'Delete marker'),
                    icon: 'i-heroicons-trash',
                    color: 'red',
                    onSelect: () => deleteMarker(p.id),
                  },
                ],
              ]"
            >
              <UTooltip :text="truncateForTooltip(p.text)" :disabled="!p.text">
                <button
                  type="button"
                  class="translate-x-1 relative z-10"
                  :class="[
                    selectionStore.selectedEntity?.source === 'timeline' &&
                    selectionStore.selectedEntity?.kind === 'marker' &&
                    selectionStore.selectedEntity.markerId === p.id
                      ? (p.color ? 'ring-2 ring-white/50' : 'bg-primary-400 ring-2 ring-primary-400/50')
                      : (p.color ? '' : 'bg-primary-500'),
                  ]"
                  :style="p.color ? { color: p.color } : {}"
                  aria-label="Zone Marker End"
                  @dblclick.stop.prevent="selectMarker(p.id)"
                  @pointerdown.stop="onMarkerPointerDown($event, p.id, 'right')"
                  @contextmenu.stop
                  @click.stop="selectMarker(p.id)"
                >
                  <svg width="10" height="14" viewBox="0 0 10 14" fill="none" xmlns="http://www.w3.org/2000/svg">
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
