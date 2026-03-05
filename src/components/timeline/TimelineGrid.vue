<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { pxToTimeUs, timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { useResizeObserver } from '@vueuse/core';

const props = defineProps<{
  scrollEl: HTMLElement | null;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);

const timelineStore = useTimelineStore();
const projectStore = useProjectStore();

const width = ref(0);
const height = ref(0);
const scrollLeft = ref(0);

let tickColor = 'rgba(255, 255, 255, 0.06)';
let majorTickColor = 'rgba(255, 255, 255, 0.12)';

onMounted(() => {
  // Read theme colors and create canvas-compatible rgba values
  const el = document.createElement('div');
  el.style.color = 'var(--ui-border, #4a4a4a)';
  document.body.appendChild(el);
  const computed = window.getComputedStyle(el);
  const raw = computed.color;
  document.body.removeChild(el);

  // Parse rgb(r, g, b) from computed style
  const match = raw.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const [, r, g, b] = match;
    tickColor = `rgba(${r}, ${g}, ${b}, 0.2)`;
    majorTickColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
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
    if (oldEl) oldEl.removeEventListener('scroll', onScroll);
    if (el) {
      el.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
  },
  { immediate: true },
);

// Size from container (which is positioned by parent)
useResizeObserver(containerRef, (entries) => {
  const entry = entries[0];
  if (entry) {
    width.value = entry.contentRect.width;
    height.value = entry.contentRect.height;
    draw();
  }
});

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

  if (pxPerFrame >= 6) {
    const frameDurationUs = 1_000_000 / currentFps;
    const currentFrameStartUs = Math.floor(currentTime.value / frameDurationUs) * frameDurationUs;
    const currentFrameStartX = timeUsToPx(currentFrameStartUs, currentZoom) - startPx;

    if (currentFrameStartX < w && currentFrameStartX + pxPerFrame > 0) {
      const styles = window.getComputedStyle(document.documentElement);
      const primaryColor = styles.getPropertyValue('--color-primary-500').trim() || '#3b82f6';
      ctx.fillStyle = primaryColor;
      ctx.globalAlpha = 0.12;
      ctx.fillRect(currentFrameStartX, 0, pxPerFrame, h);
      ctx.globalAlpha = 1;
    }
  }

  // Same step calculation as TimelineRuler for perfect sync
  const MIN_DIST_PX = 90;
  const timeStepsS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  let mainStepS = timeStepsS[timeStepsS.length - 1]!;
  for (const step of timeStepsS) {
    if (step * pxPerSec >= MIN_DIST_PX) {
      mainStepS = step;
      break;
    }
  }

  const startS = Math.floor(startUs / 1_000_000 / mainStepS) * mainStepS;
  const endS = Math.ceil(endUs / 1_000_000);

  // Major tick lines (at labeled ruler marks)
  ctx.strokeStyle = majorTickColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let s = startS; s <= endS; s += mainStepS) {
    const x = Math.round(timeUsToPx(s * 1_000_000, currentZoom) - startPx) + 0.5;
    if (x >= -1 && x <= w + 1) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
  }
  ctx.stroke();

  // Second-level sub-ticks and frame lines
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let s = startS; s <= endS; s += mainStepS) {
    if (mainStepS === 1) {
      // Frame-level ticks at high zoom
      let frameStep = 1;
      if (pxPerFrame < 5) {
        frameStep = Math.ceil(5 / pxPerFrame);
      }

      const frameColor = `rgba(${tickColor.match(/(\d+),\s*(\d+),\s*(\d+)/)?.[0] || '255,255,255'}, 0.65)`;
      ctx.strokeStyle = pxPerFrame > 15 ? frameColor : tickColor;
      if (pxPerFrame > 15) ctx.lineWidth = 1.5;
      else ctx.lineWidth = 1;

      for (let f = 1; f < currentFps; f += frameStep) {
        const frameX =
          Math.round(
            timeUsToPx(s * 1_000_000 + (f * 1_000_000) / currentFps, currentZoom) - startPx,
          ) + 0.5;
        if (frameX >= -1 && frameX <= w + 1) {
          ctx.moveTo(frameX, 0);
          ctx.lineTo(frameX, h);
        }
      }
      ctx.stroke();
      ctx.beginPath(); // Reset after special stroke
    } else {
      ctx.strokeStyle = tickColor;
      ctx.lineWidth = 1;
      let subStepS = 1;
      if (mainStepS >= 60) subStepS = 10;
      else if (mainStepS >= 10) subStepS = 5;
      else if (mainStepS >= 5) subStepS = 1;

      for (let sub = s + subStepS; sub < s + mainStepS; sub += subStepS) {
        const subX = Math.round(timeUsToPx(sub * 1_000_000, currentZoom) - startPx) + 0.5;
        if (subX >= -1 && subX <= w + 1) {
          ctx.moveTo(subX, 0);
          ctx.lineTo(subX, h);
        }
      }
    }
  }
  ctx.stroke();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
</script>

<template>
  <div ref="containerRef" class="w-full h-full">
    <canvas ref="canvasRef" class="w-full h-full" />
  </div>
</template>
