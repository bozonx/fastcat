import { ref, type Ref } from 'vue';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';

export interface UseTimelineScrollSyncOptions {
  scrollEl: Ref<HTMLElement | null>;
  labelsScrollContainer: Ref<HTMLElement | null>;
  onScrollCallback?: (e: Event) => void;
}

export function useTimelineScrollSync({
  scrollEl,
  labelsScrollContainer,
  onScrollCallback,
}: UseTimelineScrollSyncOptions) {
  const settingsStore = useTimelineSettingsStore();

  const isPanning = ref(false);
  const panStart = ref({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  function onScroll(e: Event) {
    if (!scrollEl.value || !labelsScrollContainer.value) return;
    labelsScrollContainer.value.scrollTop = scrollEl.value.scrollTop;
    onScrollCallback?.(e);
  }

  function onLabelsScroll(e: Event) {
    if (!scrollEl.value || !labelsScrollContainer.value) return;
    scrollEl.value.scrollTop = labelsScrollContainer.value.scrollTop;
  }

  function syncScrollFromExternal(scrollTop?: number, scrollLeft?: number) {
    if (scrollEl.value) {
      if (scrollTop !== undefined) scrollEl.value.scrollTop = scrollTop;
      if (scrollLeft !== undefined) scrollEl.value.scrollLeft = scrollLeft;
    }
  }

  function startPan(e: PointerEvent) {
    if (!scrollEl.value) return;
    e.preventDefault();
    isPanning.value = true;
    panStart.value = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: scrollEl.value.scrollLeft,
      scrollTop: scrollEl.value.scrollTop,
    };
    scrollEl.value.setPointerCapture(e.pointerId);
  }

  function onPanMove(e: PointerEvent) {
    if (!isPanning.value || !scrollEl.value) return;
    e.preventDefault();
    const dx = e.clientX - panStart.value.x;
    const dy = e.clientY - panStart.value.y;
    scrollEl.value.scrollLeft = panStart.value.scrollLeft - dx;
    scrollEl.value.scrollTop = panStart.value.scrollTop - dy;
  }

  function stopPan(e: PointerEvent) {
    if (!isPanning.value || !scrollEl.value) return;
    e.preventDefault();
    isPanning.value = false;
    scrollEl.value.releasePointerCapture(e.pointerId);
  }

  return {
    isPanning,
    onScroll,
    onLabelsScroll,
    syncScrollFromExternal,
    startPan,
    onPanMove,
    stopPan,
  };
}
