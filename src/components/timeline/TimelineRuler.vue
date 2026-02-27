<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { pxToTimeUs, timeUsToPx, zoomToPxPerSecond } from '~/composables/timeline/useTimelineInteraction';
import { useResizeObserver } from '@vueuse/core';

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
    width.value = entry.contentRect.width;
    height.value = entry.contentRect.height;
    draw();
  }
});

function onScroll() {
  if (props.scrollEl) {
    scrollLeft.value = props.scrollEl.scrollLeft;
    draw();
  }
}

watch(() => props.scrollEl, (el, oldEl) => {
  if (oldEl) {
    oldEl.removeEventListener('scroll', onScroll);
  }
  if (el) {
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
}, { immediate: true });

onUnmounted(() => {
  if (props.scrollEl) {
    props.scrollEl.removeEventListener('scroll', onScroll);
  }
});

const fps = computed(() => projectStore.projectSettings.export.fps || 30);
const zoom = computed(() => timelineStore.timelineZoom);

watch([fps, zoom, width, height, scrollLeft], () => {
  requestAnimationFrame(draw);
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
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  const currentZoom = zoom.value;
  const currentFps = fps.value;
  const pxPerSec = zoomToPxPerSecond(currentZoom);

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

  ctx.fillStyle = textColor;
  ctx.strokeStyle = tickColor; 
  ctx.lineWidth = 1;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const startS = Math.floor((startUs / 1_000_000) / mainStepS) * mainStepS;
  const endS = Math.ceil(endUs / 1_000_000);

  ctx.beginPath();
  for (let s = startS; s <= endS; s += mainStepS) {
    const x = Math.round(timeUsToPx(s * 1_000_000, currentZoom) - startPx) + 0.5;
    
    if (x >= -50 && x <= w + 50) {
      ctx.moveTo(x, h - 8);
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
        const frameX = Math.round(timeUsToPx(s * 1_000_000 + (f * 1_000_000 / currentFps), currentZoom) - startPx) + 0.5;
        if (frameX >= 0 && frameX <= w) {
          ctx.moveTo(frameX, h - 4);
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
        if (subX >= 0 && subX <= w) {
          ctx.moveTo(subX, h - 4);
          ctx.lineTo(subX, h);
        }
      }
    }
  }
  ctx.stroke();
}
</script>

<template>
  <div 
    ref="containerRef" 
    class="relative w-full overflow-hidden"
    @mousedown="$emit('mousedown', $event)"
  >
    <canvas 
      ref="canvasRef" 
      class="absolute top-0 left-0 w-full h-full pointer-events-none" 
    />
  </div>
</template>
