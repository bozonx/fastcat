import { invoke } from '@tauri-apps/api/core';
import { onMounted, onScopeDispose, watch, type Ref } from 'vue';

import { useMonitorMode } from '~/composables/monitor/useNativeMonitorMode';
import { createDevLogger } from '~/utils/dev-logger';
import { isTauriRuntime } from '~/utils/runtime';
import {
  isNativeMonitorDisabled,
  markNativeMonitorInitFailure,
} from '~/composables/monitor/native-monitor-availability';

const log = createDevLogger('useNativeMonitorViewport');

interface ViewportPayload {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  [key: string]: unknown;
}

/**
 * Привязывает положение и размер child-окна нативного монитора к DOM-элементу.
 *
 * Используем rAF-loop с диффом: каждое значимое изменение `getBoundingClientRect()`
 * (любые причины — resize окна, изменение layout панелей, скролл предка) приводит к
 * одному `invoke('monitor_set_viewport')`. Без изменений — IPC не дёргается.
 *
 * Координаты — в физических пикселях относительно клиентской области главного окна Tauri:
 *   `rect.left * dpr`, `rect.top * dpr`, `rect.width * dpr`, `rect.height * dpr`.
 * На десктопе вебвью занимает всю клиентскую область, так что viewport-координаты совпадают.
 *
 * Видимость = ширина и высота > 0 И элемент находится в пределах вьюпорта. Невидимый элемент
 * скрывает нативное окно, чтобы оно не «висело» поверх UI при сворачивании панели.
 */
export function useNativeMonitorViewport(elRef: Ref<HTMLElement | null>): void {
  if (!isTauriRuntime()) return;

  const { mode } = useMonitorMode();

  let rafHandle = 0;
  let last: ViewportPayload | null = null;
  let disposed = false;

  function warnMonitorFailure(message: string, err: unknown): void {
    const disabledNow = markNativeMonitorInitFailure(err);
    if (disabledNow || !isNativeMonitorDisabled()) {
      log.warn(message, err);
    }
  }

  function readPayload(el: HTMLElement): ViewportPayload {
    const rect = el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(rect.left * dpr);
    const y = Math.round(rect.top * dpr);
    const width = Math.max(0, Math.round(rect.width * dpr));
    const height = Math.max(0, Math.round(rect.height * dpr));
    const vw = window.innerWidth * dpr;
    const vh = window.innerHeight * dpr;
    // Невидим, если схлопнут в 0 или полностью за пределами вьюпорта.
    const offscreen = x + width <= 0 || y + height <= 0 || x >= vw || y >= vh;
    const visible = width > 0 && height > 0 && !offscreen;
    return { x, y, width, height, visible };
  }

  function changed(a: ViewportPayload | null, b: ViewportPayload): boolean {
    if (!a) return true;
    return (
      a.x !== b.x ||
      a.y !== b.y ||
      a.width !== b.width ||
      a.height !== b.height ||
      a.visible !== b.visible
    );
  }

  function tick(): void {
    if (disposed) return;
    rafHandle = window.requestAnimationFrame(tick);
    const el = elRef.value;
    if (!el) return;
    const raw = readPayload(el);
    // В canvas-режиме нативное X11-окно должно быть скрыто — рендер идёт offscreen,
    // изображение приходит в HTML <canvas>. Геометрию шлём всё равно (чтобы при возврате
    // в embedded окно сразу встало на место), но visible форсим в false.
    const next: ViewportPayload = mode.value === 'canvas' ? { ...raw, visible: false } : raw;
    if (!changed(last, next)) return;
    last = next;
    if (isNativeMonitorDisabled()) return;
    invoke('monitor_set_viewport', next).catch((err) =>
      warnMonitorFailure('monitor_set_viewport failed', err),
    );
  }

  onMounted(() => {
    rafHandle = window.requestAnimationFrame(tick);
  });

  watch(elRef, (el) => {
    if (!el) return;
    // Пересоздать last, чтобы сразу же отправить актуальный rect.
    last = null;
  });

  onScopeDispose(() => {
    disposed = true;
    if (rafHandle) window.cancelAnimationFrame(rafHandle);
    if (isNativeMonitorDisabled()) return;
    // Скрыть нативное окно — оно может пережить unmount компонента (event-loop живёт
    // в отдельном потоке и закрывается через `monitor_close` из useNativeMonitorBridge).
    invoke('monitor_set_viewport', {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      visible: false,
    }).catch(() => {
      // ignore — окно может уже быть закрыто
    });
  });
}
