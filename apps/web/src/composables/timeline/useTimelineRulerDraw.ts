import { computed, ref, watch, type Ref } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { pxToTimeTicks, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { frameToTicks, ticksToFrame } from '~/timeline/commands/utils';
import {
  getFirstTimelineRulerMajorFrame,
  getTimelineFrameTickCanvasX,
  getTimelineRulerMainStepS,
  getTimelineRulerSubStepFrames,
  getTimelineTickCanvasX,
} from '~/utils/timeline/ruler-ticks';
import { formatRulerTime } from './useTimelineRulerPresentation';

interface TimelineRulerDrawOptions {
  containerRef: Ref<HTMLElement | null>;
  canvasRef: Ref<HTMLCanvasElement | null>;
  width: Ref<number>;
  height: Ref<number>;
  scrollLeft: Ref<number>;
  zoom: Ref<number>;
  fps: Ref<number>;
  textColor: string;
  tickColor: string;
  majorTickWidth: number;
  subTickWidth: number;
  interfaceScale: Ref<number>;
  isMobile?: Ref<boolean | undefined>;
}

export function useTimelineRulerDraw(options: TimelineRulerDrawOptions) {
  const renderStartPx = ref(0);
  const renderWidthPx = ref(0);
  let drawRafId: number | null = null;

  const canvasStyle = computed(() => ({
    width: `${renderWidthPx.value || options.width.value}px`,
    height: '100%',
    transform: `translate3d(${renderStartPx.value - options.scrollLeft.value}px, 0, 0)`,
    willChange: 'transform',
  }));

  function shouldRedrawForScroll(nextScrollLeft: number) {
    const viewportWidth = options.width.value;
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

  watch(
    () => options.scrollLeft.value,
    (nextScrollLeft) => {
      if (shouldRedrawForScroll(nextScrollLeft)) {
        scheduleDraw();
      }
    },
    { immediate: true },
  );

  useResizeObserver(options.containerRef, (entries) => {
    const entry = entries[0];
    if (entry) {
      options.width.value = entry.contentRect.width;
      options.height.value = entry.contentRect.height;
      scheduleDraw();
    }
  });

  onUnmounted(() => {
    if (drawRafId !== null) {
      cancelAnimationFrame(drawRafId);
      drawRafId = null;
    }
  });

  function draw() {
    const canvas = options.canvasRef.value;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = options.width.value;
    const h = options.height.value;

    if (w === 0 || h === 0) return;

    const bufferPx = Math.max(512, Math.round(w));
    const nextRenderStartPx = Math.max(0, options.scrollLeft.value - bufferPx);
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

    const currentZoom = options.zoom.value;
    const currentFps = options.fps.value;
    const pxPerSec = zoomToPxPerSecond(currentZoom);
    const pxPerFrame = pxPerSec / currentFps;

    const scale = options.interfaceScale.value / 14;
    const isMobile = options.isMobile?.value;

    const startPx = nextRenderStartPx;
    const endPx = startPx + nextRenderWidthPx;
    const startTicks = pxToTimeTicks(startPx, currentZoom);
    const endTicks = pxToTimeTicks(endPx, currentZoom);

    const mainStepS = getTimelineRulerMainStepS({
      pxPerSecond: pxPerSec,
      interfaceScale: options.interfaceScale.value,
    });

    ctx.fillStyle = options.textColor;
    ctx.strokeStyle = options.tickColor;
    ctx.lineWidth = options.majorTickWidth;
    ctx.font = `${9 * scale}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const mainStepFrames = Math.max(1, Math.round(mainStepS * currentFps));
    const startFrame = ticksToFrame(startTicks, currentFps, 'floor');
    const endFrame = ticksToFrame(endTicks, currentFps, 'ceil');
    const firstMajorFrame = getFirstTimelineRulerMajorFrame({
      startFrame,
      endFrame,
      mainStepFrames,
    });

    const majorTickHeight = 12 * scale;
    const subTickHeight = 5 * scale;
    const textTopOffset = (isMobile ? 4 : 2) * scale;

    ctx.beginPath();
    for (let frame = firstMajorFrame; frame <= endFrame; frame += mainStepFrames) {
      const tickTicks = frameToTicks(frame, currentFps);
      const x = getTimelineTickCanvasX({
        timeTicks: tickTicks,
        zoom: currentZoom,
        renderStartPx: startPx,
      });

      if (x >= -50 && x <= nextRenderWidthPx + 50) {
        ctx.moveTo(x, h - majorTickHeight);
        ctx.lineTo(x, h);
        ctx.fillText(formatRulerTime(tickTicks, currentFps), x, textTopOffset);
      }
    }
    ctx.stroke();

    ctx.lineWidth = options.subTickWidth;
    ctx.beginPath();

    for (let frame = firstMajorFrame; frame <= endFrame; frame += mainStepFrames) {
      if (mainStepS === 1) {
        let frameStep = 1;
        const minFrameDist = 5 * scale;
        if (pxPerFrame < minFrameDist) {
          frameStep = Math.ceil(minFrameDist / pxPerFrame);
        }

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
          if (frameX >= -50 && frameX <= nextRenderWidthPx + 50) {
            ctx.moveTo(frameX, h - subTickHeight);
            ctx.lineTo(frameX, h);
          }
        }
      } else {
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
          if (subX >= -50 && subX <= nextRenderWidthPx + 50) {
            ctx.moveTo(subX, h - subTickHeight);
            ctx.lineTo(subX, h);
          }
        }
      }
    }
    ctx.stroke();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  return {
    canvasStyle,
    scheduleDraw,
  };
}
