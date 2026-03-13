import { watch, type Ref } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { pxToTimeUs, timeUsToPx, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import { formatRulerTime } from './useTimelineRulerPresentation';

interface TimelineRulerDrawOptions {
  containerRef: Ref<HTMLElement | null>;
  canvasRef: Ref<HTMLCanvasElement | null>;
  scrollEl: Ref<HTMLElement | null>;
  width: Ref<number>;
  height: Ref<number>;
  scrollLeft: Ref<number>;
  zoom: Ref<number>;
  fps: Ref<number>;
  textColor: string;
  tickColor: string;
  majorTickWidth: number;
  subTickWidth: number;
}

export function useTimelineRulerDraw(options: TimelineRulerDrawOptions) {
  let drawRafId: number | null = null;

  function scheduleDraw() {
    if (drawRafId !== null) return;
    drawRafId = requestAnimationFrame(() => {
      drawRafId = null;
      draw();
    });
  }

  function onScroll() {
    if (options.scrollEl.value) {
      options.scrollLeft.value = options.scrollEl.value.scrollLeft;
      if (drawRafId !== null) {
        cancelAnimationFrame(drawRafId);
        drawRafId = null;
      }
      draw();
    }
  }

  watch(
    options.scrollEl,
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

  useResizeObserver(options.containerRef, (entries) => {
    const entry = entries[0];
    if (entry) {
      options.width.value = entry.contentRect.width;
      options.height.value = entry.contentRect.height;
      scheduleDraw();
    }
  });

  onUnmounted(() => {
    if (options.scrollEl.value) {
      options.scrollEl.value.removeEventListener('scroll', onScroll);
    }
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

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const currentZoom = options.zoom.value;
    const currentFps = options.fps.value;
    const pxPerSec = zoomToPxPerSecond(currentZoom);
    const pxPerFrame = pxPerSec / currentFps;

    const startPx = options.scrollLeft.value;
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

    ctx.fillStyle = options.textColor;
    ctx.strokeStyle = options.tickColor;
    ctx.lineWidth = options.majorTickWidth;
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
        ctx.fillText(formatRulerTime(s * 1_000_000, currentFps), x, 4);
      }
    }
    ctx.stroke();

    ctx.lineWidth = options.subTickWidth;
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

  return {
    scheduleDraw,
  };
}
