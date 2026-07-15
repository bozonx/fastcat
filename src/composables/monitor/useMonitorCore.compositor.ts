import { createDevLogger } from '~/utils/dev-logger';
import { normalizeTicks } from '~/utils/time';
import type { PreviewRenderOptions, VideoCoreWorkerAPI } from '~/utils/video-editor/worker-rpc';
const log = createDevLogger('useMonitorCore.compositor');

export interface CreateMonitorCompositorRuntimeOptions {
  client: VideoCoreWorkerAPI | null;
  containerEl: { value: HTMLDivElement | null };
  renderWidth: { value: number };
  renderHeight: { value: number };
  designWidth: { value: number };
  designHeight: { value: number };
  isUnmounted: () => boolean;
  getPreviewRenderOptions: () => PreviewRenderOptions;
}

export interface EnsureMonitorCompositorReadyOptions {
  forceRecreate?: boolean;
}

export interface MonitorRenderScheduleOptions {
  prewarm?: boolean;
}

export function createMonitorCompositorRuntime(options: CreateMonitorCompositorRuntimeOptions) {
  let canvasEl: HTMLCanvasElement | null = null;
  let compositorReady = false;
  let compositorWidth = 0;
  let compositorHeight = 0;
  let latestRenderRequest: { timeUs: number; prewarm: boolean } | null = null;
  // Prewarm cadence is gated by WALL CLOCK, not timeline time. A timeline-time
  // gate ("fire when playhead moved ≥250ms past the last prewarm position") goes
  // permanently silent after a backward seek: the delta turns negative and stays
  // negative until the playhead re-passes the old mark — measured in-app as
  // `prewarm runs=0` for entire sessions, i.e. every played frame decoding cold.
  let lastPrewarmAtMs = -Infinity;

  const VIDEO_PREWARM_INTERVAL_MS = 250;

  // Dev-only rolling stats for the main-thread side of the render pipe: how many
  // renders were requested vs actually round-tripped to the worker, and what the
  // RPC round-trip costs. `scheduled - completed` = requests coalesced away while
  // a previous render was in flight, i.e. frames dropped on the main thread —
  // this is the number that shows whether low playback fps is worker-render-bound.
  const RPC_STATS_FLUSH_MS = 3_000;
  const rpcStats = { scheduled: 0, completed: 0, rpcMsTotal: 0, rpcMsMax: 0, windowStartMs: 0 };
  function noteRenderRpc(ms: number) {
    rpcStats.completed += 1;
    rpcStats.rpcMsTotal += ms;
    if (ms > rpcStats.rpcMsMax) rpcStats.rpcMsMax = ms;
    const nowMs = performance.now();
    if (rpcStats.windowStartMs === 0) {
      rpcStats.windowStartMs = nowMs;
      return;
    }
    const elapsedMs = nowMs - rpcStats.windowStartMs;
    if (elapsedMs < RPC_STATS_FLUSH_MS) return;
    const seconds = elapsedMs / 1000;
    log.log(
      `[MonitorRPC] scheduled=${(rpcStats.scheduled / seconds).toFixed(1)}/s ` +
        `completed=${(rpcStats.completed / seconds).toFixed(1)}/s ` +
        `dropped=${rpcStats.scheduled - rpcStats.completed} ` +
        `rpcMs avg=${(rpcStats.completed ? rpcStats.rpcMsTotal / rpcStats.completed : 0).toFixed(1)} max=${rpcStats.rpcMsMax.toFixed(1)}`,
    );
    rpcStats.scheduled = 0;
    rpcStats.completed = 0;
    rpcStats.rpcMsTotal = 0;
    rpcStats.rpcMsMax = 0;
    rpcStats.windowStartMs = nowMs;
  }

  function isReady() {
    return compositorReady;
  }

  function invalidate() {
    compositorReady = false;
  }

  function clearPendingRender() {
    latestRenderRequest = null;
  }

  async function ensureReady(ensureOptions?: EnsureMonitorCompositorReadyOptions) {
    // No web compositor in Tauri mode (native monitor draws preview).
    if (!options.client) {
      compositorReady = false;
      return;
    }
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
      'transparent',
      options.getPreviewRenderOptions().pixiRenderer,
      options.designWidth.value,
      options.designHeight.value,
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

  // Pipeline depth for render RPCs. The worker has its own coalescing render loop
  // (renderInFlight + latest-request-wins in video-core.worker.ts), so sending the
  // next request while one is still in flight just parks it worker-side and lets
  // the worker render back-to-back. Depth 1 (the old await-per-request loop) made
  // the main thread wait a full RPC round trip between renders, capping playback
  // at 1/RTT fps (~16/s measured at ~60 ms RTT) even when the worker rendered in
  // 12 ms. Depth 2 hides the RTT completely; deeper would only buffer stale times.
  const MAX_INFLIGHT_RENDER_RPCS = 2;
  let inFlightRenderRpcs = 0;

  function pumpRenderQueue() {
    if (options.isUnmounted()) {
      latestRenderRequest = null;
      return;
    }
    if (!options.client || latestRenderRequest === null) return;
    if (inFlightRenderRpcs >= MAX_INFLIGHT_RENDER_RPCS) return;

    const nextRequest = latestRenderRequest;
    latestRenderRequest = null;
    const nextTimeUs = nextRequest.timeUs;

    inFlightRenderRpcs += 1;
    const rpcStartMs = performance.now();
    options.client
      .renderFrame(nextTimeUs, options.getPreviewRenderOptions())
      .catch((err) => {
        log.error('[Monitor] Render failed', err);
      })
      .finally(() => {
        inFlightRenderRpcs -= 1;
        noteRenderRpc(performance.now() - rpcStartMs);
        pumpRenderQueue();
      });

    if (nextRequest.prewarm && performance.now() - lastPrewarmAtMs >= VIDEO_PREWARM_INTERVAL_MS) {
      lastPrewarmAtMs = performance.now();
      void options.client.prewarmVideoFrames?.(nextTimeUs).catch((err) => {
        log.warn('[Monitor] Video prewarm failed', err);
      });
    }
  }

  function scheduleRender(timeUs: number, renderOptions?: MonitorRenderScheduleOptions) {
    if (options.isUnmounted()) return;
    if (!options.client) return; // native monitor handles preview
    rpcStats.scheduled += 1;
    latestRenderRequest = {
      timeUs: normalizeTicks(timeUs),
      prewarm: renderOptions?.prewarm === true,
    };
    pumpRenderQueue();
  }

  async function destroy() {
    clearPendingRender();
    if (options.client) {
      await options.client.destroyCompositor();
    }
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
