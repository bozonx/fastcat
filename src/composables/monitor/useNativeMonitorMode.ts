import { Channel } from '@tauri-apps/api/core';
import { nativeMonitorIpc } from '~/composables/monitor/native-monitor-ipc';
import { computed, nextTick, ref, watch, onMounted, onScopeDispose, type Ref } from 'vue';

import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';
import {
  isNativeMonitorDisabled,
  markNativeMonitorInitFailure,
} from '~/composables/monitor/native-monitor-availability';
import { useProjectStore } from '~/stores/project.store';

const log = createDevLogger('useNativeMonitorMode');

export type MonitorMode = 'embedded' | 'canvas';

// Default readback ceiling in canvas mode during playback/interaction in "Auto" mode
// (previewResolution = 0). Beyond that the browser CSS-stretches. This is the decisive
// performance factor: GPU→CPU readback + IPC scale as O(w*h). ~960px yields ~2-3 MB/frame
// instead of 8+ MB for FullHD. When the user explicitly selects a preview resolution
// (previewResolution > 0), the ceiling is taken from it — see resolvePlaybackMaxRenderDim.
const MAX_RENDER_DIM = 960;

// Cap for a "settled" still frame (paused with no active scrubbing/edits): readback here is
// a one-off, so we render at the real screen resolution (layout*dpr, no CSS upscaling),
// keeping text/border/shape edges crisp — like export quality via the ultra debounce.
// Capped above to avoid running 8K readback on huge panels unnecessarily.
const MAX_STILL_RENDER_DIM = 3840;

// true → the still frame is rendered without the 960-cap (at full resolution). The flag is
// set by the bridge (useNativeMonitorBridge) in sync with the same ultra debounce that raises
// effect quality on a settled pause; reset during playback and interaction.
export const stillFrameFullRes = ref(false);

/**
 * Global (module-level) reactive monitor mode. In the Tauri panel we default to canvas
 * stream; a separate native window is opened via an explicit command.
 */
const mode = ref<MonitorMode>('canvas');

/**
 * Ceiling for the long edge of the readback target for a NOT-settled frame (playback or
 * interactive scrubbing). Respects the user's explicit choice in the "Preview resolution"
 * menu (`previewResolution` — fraction of displayed pixels: 1 = full, 0.5 = half, etc.),
 * otherwise (Auto = 0) keeps the cheap default MAX_RENDER_DIM. Still capped above by the
 * real displayed pixels and MAX_STILL_RENDER_DIM — there is no point rendering more than is
 * visible on screen. A settled still frame bypasses this path (full resolution).
 */
export function resolvePlaybackMaxRenderDim(params: {
  displayLongEdgePx: number;
  previewResolution: number;
  autoDefault?: number;
  ceiling?: number;
}): number {
  const ceiling = params.ceiling ?? MAX_STILL_RENDER_DIM;
  const scale = params.previewResolution;
  if (scale > 0) {
    const target = Math.round(params.displayLongEdgePx * scale);
    return Math.max(1, Math.min(ceiling, target));
  }
  return Math.min(ceiling, params.autoDefault ?? MAX_RENDER_DIM);
}

export function resolveNativeMonitorCanvasSize(params: {
  layoutWidth: number;
  layoutHeight: number;
  dpr: number;
  maxRenderDim?: number;
}): { width: number; height: number } {
  const maxRenderDim = params.maxRenderDim ?? MAX_RENDER_DIM;
  let width = Math.max(1, Math.round(params.layoutWidth * params.dpr));
  let height = Math.max(1, Math.round(params.layoutHeight * params.dpr));
  const longest = Math.max(width, height);
  if (longest > maxRenderDim) {
    const scale = maxRenderDim / longest;
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  return { width, height };
}

export function useMonitorMode() {
  return {
    mode,
    toggle: () => {
      mode.value = mode.value === 'embedded' ? 'canvas' : 'embedded';
    },
    set: (m: MonitorMode) => {
      mode.value = m;
    },
  };
}

/**
 * Links the `mode` state to the native side: sends `monitor_set_mode`, manages the
 * RGBA frame stream subscription, and draws the frames onto the provided `<canvas>`.
 *
 * Pass a ref to a CANVAS element (not a div). The canvas must be visible in `canvas`
 * mode and have a pixel size = its CSS size * devicePixelRatio (we set it ourselves).
 */
export function useNativeMonitorCanvas(canvasRef: Ref<HTMLCanvasElement | null>): void {
  if (!isTauriRuntime()) return;

  const projectStore = useProjectStore();

  let unsubChannel: (() => void) | null = null;
  let disposed = false;
  // Cache the 2D context: calling getContext on every stream frame is wasteful.
  let ctx2d: CanvasRenderingContext2D | null = null;
  let ctxEl: HTMLCanvasElement | null = null;
  let ro: ResizeObserver | null = null;

  function getCtx(el: HTMLCanvasElement): CanvasRenderingContext2D | null {
    if (ctxEl !== el || !ctx2d) {
      ctxEl = el;
      ctx2d = el.getContext('2d');
    }
    return ctx2d;
  }

  function warnMonitorFailure(message: string, err: unknown): void {
    const disabledNow = markNativeMonitorInitFailure(err);
    if (disabledNow || !isNativeMonitorDisabled()) {
      log.warn(message, err);
    }
  }

  // Canvas (drawing buffer) size in physical pixels. The CSS size is set by styles and may
  // differ — the browser will stretch/compress the buffer. This is critical for performance.
  function syncCanvasSize(): void {
    const el = canvasRef.value;
    if (!el) return;
    const layoutWidth = el.offsetWidth || el.clientWidth || el.getBoundingClientRect().width;
    const layoutHeight = el.offsetHeight || el.clientHeight || el.getBoundingClientRect().height;
    const dpr = window.devicePixelRatio || 1;
    // Settled still frame → full screen resolution; otherwise (playback/scrubbing) the
    // ceiling from the user-selected "Preview resolution" (Auto → cheap default).
    const maxRenderDim = stillFrameFullRes.value
      ? MAX_STILL_RENDER_DIM
      : resolvePlaybackMaxRenderDim({
          displayLongEdgePx: Math.max(
            Math.round(layoutWidth * dpr),
            Math.round(layoutHeight * dpr),
          ),
          previewResolution: projectStore.activeMonitor?.previewResolution ?? 0,
        });
    const { width: w, height: h } = resolveNativeMonitorCanvasSize({
      layoutWidth,
      layoutHeight,
      dpr,
      maxRenderDim,
    });
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    if (isNativeMonitorDisabled()) return;
    nativeMonitorIpc
      .setCanvasSize(w, h)
      .catch((err) => warnMonitorFailure('monitor_set_canvas_size failed', err));
  }

  function drawFrame(buffer: ArrayBuffer): void {
    const el = canvasRef.value;
    if (!el) return;
    if (buffer.byteLength < 8) return;
    const view = new DataView(buffer);
    const width = view.getUint32(0, true);
    const height = view.getUint32(4, true);
    // Guard against a truncated/corrupt frame: otherwise Uint8ClampedArray(...) throws RangeError.
    const expectedBytes = 8 + width * height * 4;
    if (width === 0 || height === 0 || buffer.byteLength < expectedBytes) return;
    const pixels = new Uint8ClampedArray(buffer, 8, width * height * 4);
    if (el.width !== width || el.height !== height) {
      el.width = width;
      el.height = height;
    }
    el.style.background = 'transparent';
    const ctx = getCtx(el);
    if (!ctx) return;
    const imageData = new ImageData(pixels, width, height);
    ctx.putImageData(imageData, 0, 0);
  }

  async function subscribe(): Promise<void> {
    if (isNativeMonitorDisabled()) return;
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (data) => {
      // Tauri returns InvokeResponseBody::Raw as an ArrayBuffer on the JS side.
      if (data instanceof ArrayBuffer) {
        drawFrame(data);
      } else if (ArrayBuffer.isView(data)) {
        const view = data as ArrayBufferView;
        drawFrame(
          (view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength),
        );
      }
    };
    try {
      await nativeMonitorIpc.subscribeFrames(channel);
      if (disposed) {
        channel.onmessage = () => {};
        await nativeMonitorIpc.unsubscribeFrames();
        return;
      }
      unsubChannel = () => {
        channel.onmessage = () => {};
      };
    } catch (err) {
      warnMonitorFailure('monitor_subscribe_frames failed', err);
    }
  }

  async function activateCanvasMode(): Promise<void> {
    await nextTick();
    syncCanvasSize();
    if (!unsubChannel) await subscribe();
  }

  watch(
    mode,
    async (m) => {
      if (isNativeMonitorDisabled()) return;
      try {
        await nativeMonitorIpc.setMode(m);
      } catch (err) {
        warnMonitorFailure('monitor_set_mode failed', err);
      }
      if (isNativeMonitorDisabled()) return;
      if (m === 'canvas') {
        await activateCanvasMode();
      } else if (unsubChannel) {
        unsubChannel();
        unsubChannel = null;
        await nativeMonitorIpc
          .unsubscribeFrames()
          .catch((err) => warnMonitorFailure('monitor_unsubscribe_frames failed', err));
      }
    },
    { immediate: true },
  );

  function observeCanvas(): void {
    ro?.disconnect();
    ro = null;
    const el = canvasRef.value;
    if (!el) return;
    ro = new ResizeObserver(() => {
      if (mode.value === 'canvas') syncCanvasSize();
    });
    ro.observe(el);
  }

  // The "settled pause ↔ interactive" transition and a change of the selected "Preview
  // resolution" change the readback ceiling → rebuild the target size. While paused,
  // SetCanvasSize on the native side redraws the frame itself.
  watch([stillFrameFullRes, () => projectStore.activeMonitor?.previewResolution], () => {
    if (mode.value === 'canvas') syncCanvasSize();
  });

  // Reactively adjust the canvas size on resize.
  onMounted(() => {
    observeCanvas();
  });

  watch(canvasRef, (el) => {
    observeCanvas();
    if (el && mode.value === 'canvas') void activateCanvasMode();
  });

  onScopeDispose(() => {
    disposed = true;
    ro?.disconnect();
    unsubChannel?.();
    ctx2d = null;
    ctxEl = null;
    if (!isNativeMonitorDisabled()) {
      nativeMonitorIpc
        .unsubscribeFrames()
        .catch((err) => warnMonitorFailure('monitor_unsubscribe_frames failed', err));
    }
  });
}

/**
 * Computed for the UI: which mode we're in, to hide/show the <canvas>.
 */
export const isCanvasMode = computed(() => mode.value === 'canvas');
export const isEmbeddedMode = computed(() => mode.value === 'embedded');
