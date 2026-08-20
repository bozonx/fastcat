import type { Ref } from 'vue';

export interface UseResizablePanelOptions {
  containerRef: Ref<HTMLElement | null>;
  orientation: Ref<'horizontal' | 'vertical'>;
  minPercent: Ref<number> | number;
  maxPercent: Ref<number> | number;
  getValue: () => number;
  setValue: (value: number) => void;
}

/**
 * Draggable panel splitter for mobile editor layouts.
 * Supports both horizontal (landscape) and vertical (portrait) orientations,
 * clamps the first panel size to the requested percent range, and uses
 * pointer capture for smooth dragging.
 */
export function useResizablePanel(options: UseResizablePanelOptions) {
  const { containerRef, orientation, minPercent, maxPercent, getValue, setValue } = options;

  function resolveMin() {
    return typeof minPercent === 'number' ? minPercent : minPercent.value;
  }

  function resolveMax() {
    return typeof maxPercent === 'number' ? maxPercent : maxPercent.value;
  }

  function onDividerPointerDown(e: PointerEvent) {
    const el = containerRef.value;
    const handle = e.currentTarget as HTMLElement | null;
    if (!el || !handle) return;

    e.preventDefault();
    handle.setPointerCapture?.(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const isHorizontal = orientation.value === 'horizontal';
      if (isHorizontal) {
        if (!rect.width) return;
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        if (!Number.isFinite(pct)) return;
        setValue(Math.min(Math.max(pct, resolveMin()), resolveMax()));
      } else {
        if (!rect.height) return;
        const pct = ((ev.clientY - rect.top) / rect.height) * 100;
        if (!Number.isFinite(pct)) return;
        setValue(Math.min(Math.max(pct, resolveMin()), resolveMax()));
      }
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      handle.removeEventListener('lostpointercapture', cleanup);
      if (handle.hasPointerCapture?.(e.pointerId)) {
        handle.releasePointerCapture?.(e.pointerId);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    handle.addEventListener('lostpointercapture', cleanup);
  }

  return {
    onDividerPointerDown,
    getValue,
  };
}
