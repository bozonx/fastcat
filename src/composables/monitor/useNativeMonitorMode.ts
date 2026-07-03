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

// Дефолтный потолок readback в canvas-режиме во время воспроизведения/интерактива в режиме
// «Auto» (previewResolution = 0). Дальше — CSS-stretch браузером. Это решающий фактор
// производительности: GPU→CPU readback + IPC масштабируются как O(w*h). ~960px даёт
// ~2-3 МБ/кадр вместо 8+ МБ для FullHD. Когда пользователь явно выбрал разрешение превью
// (previewResolution > 0), потолок берётся из него — см. resolvePlaybackMaxRenderDim.
const MAX_RENDER_DIM = 960;

// Кэп для «устоявшегося» стоп-кадра (пауза без активного скрабинга/правок): readback тут
// единичный, поэтому рендерим в реальном разрешении экрана (layout*dpr, без CSS-апскейла),
// чтобы края текста/бордера/шейпов были чёткими — как в export-качестве по ultra-дебаунсу.
// Ограничиваем сверху, чтобы не гонять readback 8K на огромных панелях без нужды.
const MAX_STILL_RENDER_DIM = 3840;

// true → still-frame рендерится без 960-кэпа (в полном разрешении). Флаг выставляет мост
// (useNativeMonitorBridge) синхронно с тем же ultra-дебаунсом, что поднимает качество
// эффектов на устоявшейся паузе; сбрасывается на время воспроизведения и интерактива.
export const stillFrameFullRes = ref(false);

/**
 * Глобальный (на модуль) реактивный режим монитора. В Tauri-панели по умолчанию
 * используем canvas stream; отдельное native-окно открывается явной командой.
 */
const mode = ref<MonitorMode>('canvas');

/**
 * Потолок длинной стороны readback-таргета для НЕ-устоявшегося кадра (воспроизведение или
 * интерактивный скрабинг). Уважает явный выбор пользователя в меню «Разрешение превью»
 * (`previewResolution` — доля отображаемых пикселей: 1 = полное, 0.5 = половина и т.д.),
 * иначе (Auto = 0) держит дешёвый дефолт MAX_RENDER_DIM. Сверху всё равно ограничено
 * реальными отображаемыми пикселями и MAX_STILL_RENDER_DIM — рендерить больше, чем видно
 * на экране, смысла нет. Устоявшийся стоп-кадр этот путь минует (полное разрешение).
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
 * Связывает состояние `mode` с нативной стороной: шлёт `monitor_set_mode`,
 * управляет подпиской на стрим RGBA-кадров и рисует их на переданном `<canvas>`.
 *
 * Передавать сюда нужно ref на CANVAS элемент (не div). Canvas должен быть видим в режиме
 * `canvas` и иметь pixel size = его CSS size * devicePixelRatio (мы сами выставляем).
 */
export function useNativeMonitorCanvas(canvasRef: Ref<HTMLCanvasElement | null>): void {
  if (!isTauriRuntime()) return;

  const projectStore = useProjectStore();

  let unsubChannel: (() => void) | null = null;
  let disposed = false;
  // Кешируем 2D-контекст: getContext на каждый кадр стрима — лишняя работа.
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

  // Размер canvas (drawing buffer) в физ. пикселях. CSS-размер задаётся стилями и
  // может отличаться — браузер растянет/сожмёт буфер. Это критично для производительности.
  function syncCanvasSize(): void {
    const el = canvasRef.value;
    if (!el) return;
    const layoutWidth = el.offsetWidth || el.clientWidth || el.getBoundingClientRect().width;
    const layoutHeight = el.offsetHeight || el.clientHeight || el.getBoundingClientRect().height;
    const dpr = window.devicePixelRatio || 1;
    // Устоявшийся стоп-кадр → полное разрешение экрана; иначе (воспроизведение/скрабинг) —
    // потолок из выбранного пользователем «Разрешения превью» (Auto → дешёвый дефолт).
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

  // Переход «устоявшаяся пауза ↔ интерактив» и смена выбранного «Разрешения превью» меняют
  // потолок readback → пересобираем размер таргета. На паузе SetCanvasSize на нативной
  // стороне сам перерисует кадр.
  watch([stillFrameFullRes, () => projectStore.activeMonitor?.previewResolution], () => {
    if (mode.value === 'canvas') syncCanvasSize();
  });

  // Реактивно подстраиваем canvas size при resize.
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
 * Computed для UI: в каком режиме сейчас, чтобы скрыть/показать <canvas>.
 */
export const isCanvasMode = computed(() => mode.value === 'canvas');
export const isEmbeddedMode = computed(() => mode.value === 'embedded');
