<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import {
  pxToTimeUs,
  timeUsToPx,
  zoomToPxPerSecond,
} from '~/composables/timeline/useTimelineInteraction';
import { useResizeObserver } from '@vueuse/core';
import AppModal from '~/components/ui/AppModal.vue';

const { t } = useI18n();

const props = defineProps<{
  scrollEl: HTMLElement | null;
}>();

const emit = defineEmits<{
  (e: 'mousedown', event: MouseEvent): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);

const timelineStore = useTimelineStore();
const projectStore = useProjectStore();

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

const isMarkerEditOpen = ref(false);
const editingMarkerId = ref<string | null>(null);
const markerTextDraft = ref('');

const editingMarker = computed(() => {
  const id = editingMarkerId.value;
  if (!id) return null;
  return markers.value.find((m) => m.id === id) ?? null;
});

function openEditMarker(markerId: string) {
  const m = markers.value.find((x) => x.id === markerId) ?? null;
  if (!m) return;
  editingMarkerId.value = markerId;
  markerTextDraft.value = m.text ?? '';
  isMarkerEditOpen.value = true;
}

function saveMarkerText() {
  const m = editingMarker.value;
  if (!m) return;
  timelineStore.updateMarker(m.id, { text: markerTextDraft.value });
  isMarkerEditOpen.value = false;
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
      return {
        id: m.id,
        x,
        text: m.text ?? '',
      };
    })
    .filter((p) => p.x >= -20 && p.x <= w + 20);
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

  // When zooming, we want the timeline ticks to stay anchored appropriately
  // and maintain their spacing relative to the tracks
  const startPx = scrollLeft.value;
  const endPx = startPx + w;
  const startUs = pxToTimeUs(startPx, currentZoom);
  const endUs = pxToTimeUs(endPx, currentZoom);

  // Determine intervals
  const MIN_DIST_PX = 90;
  const timeStepsS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  let mainStepS = timeStepsS[timeStepsS.length - 1]!;
  for (const step of timeStepsS) {
    if (step * pxPerSec >= MIN_DIST_PX) {
      mainStepS = step;
      break;
    }
  }

  // Increase line visibility by adjusting stroke style
  ctx.fillStyle = textColor;
  ctx.strokeStyle = tickColor;
  ctx.lineWidth = 1.5; // Thicker lines for visibility
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const startS = Math.floor(startUs / 1_000_000 / mainStepS) * mainStepS;
  const endS = Math.ceil(endUs / 1_000_000);

  ctx.beginPath();
  for (let s = startS; s <= endS; s += mainStepS) {
    // Exact position in pixels from timeline start, minus scroll offset
    // This perfectly matches timeUsToPx which the tracks use
    const x = Math.round(timeUsToPx(s * 1_000_000, currentZoom) - startPx) + 0.5;

    if (x >= -50 && x <= w + 50) {
      ctx.moveTo(x, h - 12); // Taller main ticks
      ctx.lineTo(x, h);
      ctx.fillText(formatTime(s * 1_000_000, currentFps), x, 4);
    }

    // Draw sub ticks
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
          ctx.moveTo(frameX, h - 5); // Taller sub ticks
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
          ctx.moveTo(subX, h - 5); // Taller sub ticks
          ctx.lineTo(subX, h);
        }
      }
    }
  }
  ctx.stroke();

  // Draw playhead head in the ruler for better visual continuity
  const playheadPx = Math.round(timeUsToPx(currentTime.value, currentZoom) - startPx) + 0.5;
  if (playheadPx >= -10 && playheadPx <= w + 10) {
    // Determine the exact color of primary-500 if possible, or use a fallback
    const styles = window.getComputedStyle(document.documentElement);
    const primaryColor = styles.getPropertyValue('--color-primary-500').trim() || '#3b82f6';

    ctx.beginPath();
    ctx.fillStyle = primaryColor;

    // Draw an inverted triangle for the playhead
    const pw = 10; // width
    const ph = 10; // height

    ctx.moveTo(playheadPx - pw / 2, h - ph);
    ctx.lineTo(playheadPx + pw / 2, h - ph);
    ctx.lineTo(playheadPx, h);
    ctx.fill();

    // Playhead line through the remaining bottom part of the ruler
    ctx.beginPath();
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 1;
    ctx.moveTo(playheadPx, h);
    ctx.lineTo(playheadPx, h);
    ctx.stroke();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
</script>

<template>
  <div
    ref="containerRef"
    class="relative w-full overflow-hidden"
    @mousedown="$emit('mousedown', $event)"
  >
    <canvas ref="canvasRef" class="absolute top-0 left-0 w-full h-full pointer-events-none" />

    <div class="absolute inset-0 pointer-events-none">
      <div
        v-for="p in markerPoints"
        :key="p.id"
        class="absolute bottom-0 pointer-events-auto"
        :style="{ left: `${Math.round(p.x)}px` }"
      >
        <UTooltip :text="truncateForTooltip(p.text)" :disabled="!p.text">
          <button
            type="button"
            class="w-2 h-3 -translate-x-1 bg-primary-500 rounded-sm shadow-sm"
            :aria-label="'Marker'"
            @dblclick.stop.prevent="openEditMarker(p.id)"
            @mousedown.stop
          />
        </UTooltip>
      </div>
    </div>
    <AppModal v-if="editingMarker" v-model:open="isMarkerEditOpen" title="Marker">
      <div class="flex flex-col gap-3">
        <UTextarea v-model="markerTextDraft" :rows="10" size="sm" />
      </div>

      <template #footer>
        <UButton color="neutral" variant="ghost" @click="isMarkerEditOpen = false">
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton color="primary" @click="saveMarkerText">
          {{ t('common.save', 'Save') }}
        </UButton>
      </template>
    </AppModal>
  </div>
</template>
