import { ref, onUnmounted, type Ref } from 'vue';

interface AutoScrollOptions {
  zone?: number;
  maxSpeed?: number;
  onScroll?: (dy: number) => void;
}

export function useAutoScroll(
  scrollEl: Ref<HTMLElement | null>,
  options: AutoScrollOptions = {},
) {
  const { zone = 48, maxSpeed = 16 } = options;
  const lastDragEvent = ref<DragEvent | null>(null);
  let autoScrollRaf: number | null = null;
  let isWheelListenerAttached = false;

  function stopAutoScroll() {
    lastDragEvent.value = null;
    if (autoScrollRaf !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = null;
    }

    if (isWheelListenerAttached && typeof window !== 'undefined') {
      window.removeEventListener('wheel', onWindowWheel as any);
      isWheelListenerAttached = false;
    }
  }

  function onWindowWheel(e: WheelEvent) {
    const el = scrollEl.value;
    if (!el || !lastDragEvent.value) return;

    if (!Number.isFinite(e.deltaY) || e.deltaY === 0) return;

    e.preventDefault();
    el.scrollTop += e.deltaY;
  }

  function scheduleAutoScroll() {
    if (autoScrollRaf !== null || typeof window === 'undefined') return;

    const tick = () => {
      autoScrollRaf = null;
      const el = scrollEl.value;
      const ev = lastDragEvent.value;
      if (!el || !ev) return;

      const rect = el.getBoundingClientRect();
      const topDist = ev.clientY - rect.top;
      const bottomDist = rect.bottom - ev.clientY;

      let dy = 0;
      if (topDist >= 0 && topDist < zone) {
        dy = -Math.ceil(((zone - topDist) / zone) * maxSpeed);
      } else if (bottomDist >= 0 && bottomDist < zone) {
        dy = Math.ceil(((zone - bottomDist) / zone) * maxSpeed);
      }

      if (dy !== 0) {
        el.scrollTop += dy;
        if (options.onScroll) options.onScroll(dy);
        scheduleAutoScroll();
      }
    };

    autoScrollRaf = window.requestAnimationFrame(tick);
  }

  function onDragOver(e: DragEvent) {
    lastDragEvent.value = e;
    scheduleAutoScroll();

    if (!isWheelListenerAttached && typeof window !== 'undefined') {
      window.addEventListener('wheel', onWindowWheel, { passive: false });
      isWheelListenerAttached = true;
    }
  }

  function onDragLeave(e: DragEvent) {
    const currentTarget = e.currentTarget as HTMLElement | null;
    const relatedTarget = e.relatedTarget as Node | null;
    if (!currentTarget?.contains(relatedTarget)) {
      stopAutoScroll();
    }
  }

  onUnmounted(() => {
    stopAutoScroll();
  });

  return {
    onDragOver,
    onDragLeave,
    onDrop: stopAutoScroll,
    stopAutoScroll,
  };
}
