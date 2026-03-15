import { normalizeTimeUs } from '~/utils/monitor-time';
import type { PreviewRenderOptions, VideoCoreWorkerAPI } from '~/utils/video-editor/worker-rpc';

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

    if (shouldRecreate || !canvasEl || needReinit) {
      const container = options.containerEl.value;
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
      canvasEl = document.createElement('canvas');
      canvasEl.style.width = `${targetWidth}px`;
      canvasEl.style.height = `${targetHeight}px`;
      canvasEl.style.display = 'block';
      options.containerEl.value.appendChild(canvasEl);
      compositorReady = false;
    }

    if (!canvasEl) {
      return;
    }

    canvasEl.width = targetWidth;
    canvasEl.height = targetHeight;
    canvasEl.style.width = `${targetWidth}px`;
    canvasEl.style.height = `${targetHeight}px`;
    const offscreen = canvasEl.transferControlToOffscreen();
    await options.client.destroyCompositor();
    await options.client.initCompositor(offscreen, targetWidth, targetHeight, '#000');
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
        console.error('[Monitor] Render failed', err);
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
