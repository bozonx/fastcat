import { createDevLogger } from '~/utils/dev-logger';
import { normalizeTimeUs } from '~/utils/monitor-time';
import type { PreviewRenderOptions, VideoCoreWorkerAPI } from '~/utils/video-editor/worker-rpc';
const log = createDevLogger('useMonitorCore.compositor');

export interface CreateMonitorCompositorRuntimeOptions {
  client: VideoCoreWorkerAPI;
  containerEl: { value: HTMLDivElement | null };
  renderWidth: { value: number };
  renderHeight: { value: number };
  isUnmounted: () => boolean;
  getPreviewRenderOptions: () => PreviewRenderOptions;
}

export interface EnsureMonitorCompositorReadyOptions {
  forceRecreate?: boolean;
}

export function createMonitorCompositorRuntime(options: CreateMonitorCompositorRuntimeOptions) {
  let canvasEl: HTMLCanvasElement | null = null;
  let compositorReady = false;
  let compositorWidth = 0;
  let compositorHeight = 0;
  let renderLoopInFlight = false;
  let latestRenderTimeUs: number | null = null;

  function isReady() {
    return compositorReady;
  }

  function invalidate() {
    compositorReady = false;
  }

  function clearPendingRender() {
    latestRenderTimeUs = null;
  }

  async function ensureReady(ensureOptions?: EnsureMonitorCompositorReadyOptions) {
    if (!options.containerEl.value) {
      return;
    }

    const shouldRecreate = ensureOptions?.forceRecreate ?? false;
    const targetWidth = options.renderWidth.value;
    const targetHeight = options.renderHeight.value;
    const needReinit =
      !compositorReady ||
      compositorWidth !== targetWidth ||
      compositorHeight !== targetHeight ||
      shouldRecreate;

    if (!needReinit) {
      return;
    }

    const nextCanvasEl = document.createElement('canvas');
    nextCanvasEl.width = targetWidth;
    nextCanvasEl.height = targetHeight;
    nextCanvasEl.style.width = `${targetWidth}px`;
    nextCanvasEl.style.height = `${targetHeight}px`;
    nextCanvasEl.style.display = 'block';
    const offscreen = nextCanvasEl.transferControlToOffscreen();
    await options.client.destroyCompositor();
    await options.client.initCompositor(
      offscreen,
      targetWidth,
      targetHeight,
      '#000',
      options.getPreviewRenderOptions().pixiRenderer,
    );

    if (options.isUnmounted()) {
      return;
    }

    const container = options.containerEl.value;
    if (!container) {
      return;
    }

    if (canvasEl && canvasEl.parentNode === container) {
      container.replaceChild(nextCanvasEl, canvasEl);
    } else {
      container.replaceChildren(nextCanvasEl);
    }

    canvasEl = nextCanvasEl;
    compositorReady = true;
    compositorWidth = targetWidth;
    compositorHeight = targetHeight;
  }

  function scheduleRender(timeUs: number) {
    if (options.isUnmounted()) return;
    latestRenderTimeUs = normalizeTimeUs(timeUs);
    if (renderLoopInFlight) return;

    renderLoopInFlight = true;
    const run = async () => {
      try {
        while (latestRenderTimeUs !== null) {
          if (options.isUnmounted()) {
            latestRenderTimeUs = null;
            break;
          }
          const nextTimeUs = latestRenderTimeUs;
          latestRenderTimeUs = null;
          await options.client.renderFrame(nextTimeUs, options.getPreviewRenderOptions());
        }
      } catch (err) {
        log.error('[Monitor] Render failed', err);
      } finally {
        renderLoopInFlight = false;
        if (latestRenderTimeUs !== null) {
          scheduleRender(latestRenderTimeUs);
        }
      }
    };

    void run();
  }

  async function destroy() {
    clearPendingRender();
    await options.client.destroyCompositor();
  }

  return {
    clearPendingRender,
    destroy,
    ensureReady,
    invalidate,
    isReady,
    scheduleRender,
  };
}
