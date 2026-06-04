import { onMounted, onScopeDispose, watch, type Ref } from 'vue';

import { nativeMonitorIpc } from '~/composables/monitor/native-monitor-ipc';
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
 * Используем ResizeObserver + IntersectionObserver вместо rAF-loop:
 * viewport обновляется только при реальных изменениях размера/видимости элемента.
 * Это убирает постоянные layout reads (60×/сек) и снижает нагрузку на CPU.
 *
 * Координаты — в физических пикселях относительно клиентской области главного окна Tauri:
 *   `rect.left * dpr`, `rect.top * dpr`, `rect.width * dpr`, `rect.height * dpr`.
 *
 * Видимость определяется через IntersectionObserver (учитывает display:none, opacity, overflow).
 * В canvas-режиме нативное окно всегда скрывается (visible = false).
 */
export function useNativeMonitorViewport(elRef: Ref<HTMLElement | null>): void {
  if (!isTauriRuntime()) return;

  const { mode } = useMonitorMode();

  let last: ViewportPayload | null = null;
  let disposed = false;
  let ro: ResizeObserver | null = null;
  let io: IntersectionObserver | null = null;
  let isIntersecting = true;

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
    const offscreen = x + width <= 0 || y + height <= 0 || x >= vw || y >= vh;
    const visible = width > 0 && height > 0 && !offscreen && isIntersecting;
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

  function send(el: HTMLElement): void {
    const raw = readPayload(el);
    const next: ViewportPayload = mode.value === 'canvas' ? { ...raw, visible: false } : raw;
    if (!changed(last, next)) return;
    last = next;
    if (isNativeMonitorDisabled()) return;
    nativeMonitorIpc
      .setViewport(next)
      .catch((err) => warnMonitorFailure('monitor_set_viewport failed', err));
  }

  onMounted(() => {
    const el = elRef.value;
    if (!el) return;

    ro = new ResizeObserver(() => {
      if (!disposed && elRef.value) {
        send(elRef.value);
      }
    });
    ro.observe(el);

    io = new IntersectionObserver(
      (entries) => {
        isIntersecting = entries[0]?.isIntersecting ?? true;
        if (!disposed && elRef.value) {
          send(elRef.value);
        }
      },
      { threshold: 0 },
    );
    io.observe(el);

    // Initial sync
    send(el);
  });

  watch(elRef, (el) => {
    if (!el) return;
    last = null;
    ro?.disconnect();
    io?.disconnect();

    ro = new ResizeObserver(() => {
      if (!disposed && elRef.value) {
        send(elRef.value);
      }
    });
    ro.observe(el);

    io = new IntersectionObserver(
      (entries) => {
        isIntersecting = entries[0]?.isIntersecting ?? true;
        if (!disposed && elRef.value) {
          send(elRef.value);
        }
      },
      { threshold: 0 },
    );
    io.observe(el);

    send(el);
  });

  onScopeDispose(() => {
    disposed = true;
    ro?.disconnect();
    io?.disconnect();
    if (isNativeMonitorDisabled()) return;
    nativeMonitorIpc
      .setViewport({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        visible: false,
      })
      .catch(() => {
        // ignore — окно может уже быть закрыто
      });
  });
}
