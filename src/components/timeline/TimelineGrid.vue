<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { pxToTimeUs, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { usToFrame } from '~/timeline/commands/utils';
import {
  getFirstTimelineRulerMajorFrame,
  getTimelineFrameTickCanvasX,
  getTimelineRulerMainStepS,
  getTimelineRulerSubStepFrames,
} from '~/utils/timeline/ruler-ticks';
import { useResizeObserver } from '@vueuse/core';

const props = defineProps<{
  scrollEl?: HTMLElement | null;
  scrollLeft?: number;
}>();

const containerRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();

const width = ref(0);
const height = ref(0);
const scrollLeft = computed(() => props.scrollLeft ?? timelineStore.timelineScrollLeftPx);
const renderStartPx = ref(0);
const renderWidthPx = ref(0);

let tickColor = 'rgba(255, 255, 255, 0.06)';
let majorTickColor = 'rgba(255, 255, 255, 0.12)';
let drawRafId: number | null = null;

const canvasStyle = computed(() => ({
  width: `${renderWidthPx.value || width.value}px`,
  height: '100%',
  transform: `translate3d(${renderStartPx.value - scrollLeft.value}px, 0, 0)`,
  willChange: 'transform',
}));

function shouldRedrawForScroll(nextScrollLeft: number) {
  const viewportWidth = width.value;
  const bufferedWidth = renderWidthPx.value;

  if (viewportWidth <= 0 || bufferedWidth <= 0) return true;

  const renderEndPx = renderStartPx.value + bufferedWidth;
  const thresholdPx = Math.max(128, Math.round((bufferedWidth - viewportWidth) / 4));

  return (
    nextScrollLeft < renderStartPx.value + thresholdPx ||
    nextScrollLeft + viewportWidth > renderEndPx - thresholdPx
  );
}

function scheduleDraw() {
  if (drawRafId !== null) return;
  drawRafId = requestAnimationFrame(() => {
    drawRafId = null;
    draw();
  });
}

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

watch(
  scrollLeft,
  (nextScrollLeft) => {
    if (shouldRedrawForScroll(nextScrollLeft)) {
      scheduleDraw();
    }
  },
  { immediate: true },
);

useResizeObserver(containerRef, (entries) => {
  const entry = entries[0];
  if (entry) {
    width.value = entry.contentRect.width;
    height.value = entry.contentRect.height;
    scheduleDraw();
  }
});

onUnmounted(() => {
  if (drawRafId !== null) {
    cancelAnimationFrame(drawRafId);
    drawRafId = null;
  }
});

const fps = computed(() => timelineStore.timelineFormat.fps || 30);
const zoom = computed(() => timelineStore.timelineZoom);
const interfaceScale = computed(() => workspaceStore.userSettings.ui.interfaceScale);

watch([fps, zoom, width, height, interfaceScale], () => {
  scheduleDraw();
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

  const bufferPx = Math.max(512, Math.round(w));
  const nextRenderStartPx = Math.max(0, scrollLeft.value - bufferPx);
  const nextRenderWidthPx = w + bufferPx * 2;

  renderStartPx.value = nextRenderStartPx;
  renderWidthPx.value = nextRenderWidthPx;

  const targetCanvasWidth = Math.round(nextRenderWidthPx * dpr);
  const targetCanvasHeight = Math.round(h * dpr);

  if (canvas.width !== targetCanvasWidth) {
    canvas.width = targetCanvasWidth;
  }
  if (canvas.height !== targetCanvasHeight) {
    canvas.height = targetCanvasHeight;
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, nextRenderWidthPx, h);

  const currentZoom = zoom.value;
  const currentFps = fps.value;
  const pxPerSec = zoomToPxPerSecond(currentZoom);
  const pxPerFrame = pxPerSec / currentFps;

  const startPx = nextRenderStartPx;
  const endPx = startPx + nextRenderWidthPx;
  const startUs = pxToTimeUs(startPx, currentZoom);
  const endUs = pxToTimeUs(endPx, currentZoom);

  const scale = interfaceScale.value / 14;
  const mainStepS = getTimelineRulerMainStepS({
    pxPerSecond: pxPerSec,
    interfaceScale: interfaceScale.value,
  });

  const mainStepFrames = Math.max(1, Math.round(mainStepS * currentFps));
  const startFrame = usToFrame(startUs, currentFps, 'floor');
  const endFrame = usToFrame(endUs, currentFps, 'ceil');
  const firstMajorFrame = getFirstTimelineRulerMajorFrame({
    startFrame,
    endFrame,
    mainStepFrames,
  });

  // Major tick lines (at labeled ruler marks)
  ctx.strokeStyle = majorTickColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let frame = firstMajorFrame; frame <= endFrame; frame += mainStepFrames) {
    const x = getTimelineFrameTickCanvasX({
      frame,
      fps: currentFps,
      zoom: currentZoom,
      renderStartPx: startPx,
    });
    if (x >= -1 && x <= nextRenderWidthPx + 1) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
  }
  ctx.stroke();

  // Second-level sub-ticks and frame lines
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let frame = firstMajorFrame; frame <= endFrame; frame += mainStepFrames) {
    if (mainStepS === 1) {
      // Frame-level ticks at high zoom
      let frameStep = 1;
      const minFrameDistancePx = 5 * scale;
      if (pxPerFrame < minFrameDistancePx) {
        frameStep = Math.ceil(minFrameDistancePx / pxPerFrame);
      }

      const frameColor = `rgba(${tickColor.match(/(\d+),\s*(\d+),\s*(\d+)/)?.[0] || '255,255,255'}, 0.65)`;
      ctx.strokeStyle = pxPerFrame > 15 ? frameColor : tickColor;
      if (pxPerFrame > 15) ctx.lineWidth = 1.5;
      else ctx.lineWidth = 1;

      for (
        let subFrame = frame + frameStep;
        subFrame < frame + mainStepFrames;
        subFrame += frameStep
      ) {
        const frameX = getTimelineFrameTickCanvasX({
          frame: subFrame,
          fps: currentFps,
          zoom: currentZoom,
          renderStartPx: startPx,
        });
        if (frameX >= -1 && frameX <= nextRenderWidthPx + 1) {
          ctx.moveTo(frameX, 0);
          ctx.lineTo(frameX, h);
        }
      }
      ctx.stroke();
      ctx.beginPath(); // Reset after special stroke
    } else {
      ctx.strokeStyle = tickColor;
      ctx.lineWidth = 1;
      const subStepFrames = getTimelineRulerSubStepFrames({
        mainStepS,
        fps: currentFps,
      });

      for (
        let subFrame = frame + subStepFrames;
        subFrame < frame + mainStepFrames;
        subFrame += subStepFrames
      ) {
        const subX = getTimelineFrameTickCanvasX({
          frame: subFrame,
          fps: currentFps,
          zoom: currentZoom,
          renderStartPx: startPx,
        });
        if (subX >= -1 && subX <= nextRenderWidthPx + 1) {
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
  <div ref="containerRef" class="w-full h-full overflow-hidden">
    <canvas ref="canvasRef" class="absolute top-0 left-0" :style="canvasStyle" />
  </div>
</template>
