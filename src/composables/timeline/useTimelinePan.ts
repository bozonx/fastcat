import { ref, type Ref } from 'vue';
import { DRAG_DEADZONE_PX } from '~/utils/mouse';

export interface UseTimelinePanOptions {
  videoScrollEl: Ref<HTMLElement | null>;
  audioScrollEl: Ref<HTMLElement | null>;
}

interface PanState {
  x: number;
  y: number;
  scrollLeft: number;
  scrollTop: number;
  el: HTMLElement | null;
}

export function useTimelinePan({ videoScrollEl, audioScrollEl }: UseTimelinePanOptions) {
  const isPanning = ref(false);
  const hasPanned = ref(false);
  const panStart = ref<PanState>({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0, el: null });

  function getActiveScrollEl(e: PointerEvent | MouseEvent): HTMLElement | null {
    const target = e.target as HTMLElement;
    if (target.closest('.video-tracks-scroll')) return videoScrollEl.value;
    if (target.closest('.audio-tracks-scroll')) return audioScrollEl.value;
    return videoScrollEl.value;
  }

  function startPan(e: PointerEvent) {
    const el = getActiveScrollEl(e);
    if (!el) return;
    e.preventDefault();
    isPanning.value = true;
    hasPanned.value = false;
    panStart.value = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
      el,
    };
    el.setPointerCapture(e.pointerId);
  }

  function onPanMove(e: PointerEvent) {
    if (!isPanning.value || !panStart.value.el) return;
    e.preventDefault();
    const dx = e.clientX - panStart.value.x;
    const dy = e.clientY - panStart.value.y;
    if (!hasPanned.value && (Math.abs(dx) > DRAG_DEADZONE_PX || Math.abs(dy) > DRAG_DEADZONE_PX)) {
      hasPanned.value = true;
    }
    panStart.value.el.scrollLeft = panStart.value.scrollLeft - dx;
    panStart.value.el.scrollTop = panStart.value.scrollTop - dy;
  }

  function stopPan(e: PointerEvent) {
    if (!isPanning.value || !panStart.value.el) return;
    e.preventDefault();
    isPanning.value = false;
    panStart.value.el.releasePointerCapture(e.pointerId);
  }

  return {
    isPanning,
    hasPanned,
    getActiveScrollEl,
    startPan,
    onPanMove,
    stopPan,
  };
}
