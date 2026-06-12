import { Channel } from '@tauri-apps/api/core';
import { nativeMonitorIpc } from '~/composables/monitor/native-monitor-ipc';
import { computed, ref, watch, onMounted, onScopeDispose, type Ref } from 'vue';

import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';
import {
  isNativeMonitorDisabled,
  markNativeMonitorInitFailure,
} from '~/composables/monitor/native-monitor-availability';

const log = createDevLogger('useNativeMonitorMode');

export type MonitorMode = 'embedded' | 'canvas';

// Максимальный размер render target'а в canvas-режиме. Дальше — CSS-stretch браузером.
// Это решающий фактор производительности: GPU→CPU readback + IPC масштабируются как
// O(w*h). Кэп ~960px даёт ~2-3 МБ/кадр вместо 8+ МБ для FullHD.
const MAX_RENDER_DIM = 960;

/**
 * Глобальный (на модуль) реактивный режим монитора. В Tauri-панели по умолчанию
 * используем canvas stream; отдельное native-окно открывается явной командой.
 */
const mode = ref<MonitorMode>('canvas');

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
 * Связывает состояние `mode` с нативной стороной: шлёт `monitor_set_mode`,
 * управляет подпиской на стрим RGBA-кадров и рисует их на переданном `<canvas>`.
 *
 * Передавать сюда нужно ref на CANVAS элемент (не div). Canvas должен быть видим в режиме
 * `canvas` и иметь pixel size = его CSS size * devicePixelRatio (мы сами выставляем).
 */
export function useNativeMonitorCanvas(canvasRef: Ref<HTMLCanvasElement | null>): void {
  if (!isTauriRuntime()) return;

  let unsubChannel: (() => void) | null = null;
  // Кешируем 2D-контекст: getContext на каждый кадр стрима — лишняя работа.
  let ctx2d: CanvasRenderingContext2D | null = null;
  let ctxEl: HTMLCanvasElement | null = null;

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

  // Размер canvas (drawing buffer) в физ. пикселях. CSS-размер задаётся стилями и
  // может отличаться — браузер растянет/сожмёт буфер. Это критично для производительности.
  function syncCanvasSize(): void {
    const el = canvasRef.value;
    if (!el) return;
    const layoutWidth = el.offsetWidth || el.clientWidth || el.getBoundingClientRect().width;
    const layoutHeight = el.offsetHeight || el.clientHeight || el.getBoundingClientRect().height;
    const { width: w, height: h } = resolveNativeMonitorCanvasSize({
      layoutWidth,
      layoutHeight,
      dpr: window.devicePixelRatio || 1,
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
    // Защита от обрезанного/битого кадра: иначе Uint8ClampedArray(...) бросит RangeError.
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
      // Tauri отдаёт InvokeResponseBody::Raw как ArrayBuffer на стороне JS.
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
      unsubChannel = () => {
        channel.onmessage = () => {};
      };
    } catch (err) {
      warnMonitorFailure('monitor_subscribe_frames failed', err);
    }
  }

  async function activateCanvasMode(): Promise<void> {
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
      }
    },
    { immediate: true },
  );

  // Реактивно подстраиваем canvas size при resize.
  let ro: ResizeObserver | null = null;
  onMounted(() => {
    const el = canvasRef.value;
    if (!el) return;
    ro = new ResizeObserver(() => {
      if (mode.value === 'canvas') syncCanvasSize();
    });
    ro.observe(el);
  });

  watch(canvasRef, (el) => {
    if (el && mode.value === 'canvas') void activateCanvasMode();
  });

  onScopeDispose(() => {
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
 * Computed для UI: в каком режиме сейчас, чтобы скрыть/показать <canvas>.
 */
export const isCanvasMode = computed(() => mode.value === 'canvas');
export const isEmbeddedMode = computed(() => mode.value === 'embedded');
