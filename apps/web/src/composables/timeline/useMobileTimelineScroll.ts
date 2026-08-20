import { nextTick, watch, type ComputedRef, type Ref } from 'vue';
import { useElementSize } from '@vueuse/core';
import { computeTimelineScrollLeftForPlayhead } from '~/utils/timeline/geometry';
import type { useTimelineStore } from '~/stores/timeline.store';

export interface UseMobileTimelineScrollOptions {
  scrollEl: Ref<HTMLElement | null>;
  playheadPx: ComputedRef<number>;
  timelineStore: ReturnType<typeof useTimelineStore>;
}

export function useMobileTimelineScroll(options: UseMobileTimelineScrollOptions) {
  const { scrollEl, playheadPx, timelineStore } = options;

  // Reactive viewport width of the scroll container. Needed so clip thumbnails
  // know the visible window — without it the thumbnail strip computes a zero-width
  // range and renders nothing on mobile.
  const { width: scrollViewportWidth } = useElementSize(scrollEl);

  function scrollPlayheadIntoView() {
    const el = scrollEl.value;
    if (!el) return;

    const nextScrollLeft = computeTimelineScrollLeftForPlayhead({
      playheadPx: playheadPx.value,
      scrollLeft: el.scrollLeft,
      viewportWidth: el.clientWidth,
      maxScrollLeft: el.scrollWidth - el.clientWidth,
    });

    if (nextScrollLeft === null) {
      timelineStore.timelineScrollLeftPx = el.scrollLeft;
      return;
    }

    el.scrollLeft = nextScrollLeft;
    timelineStore.timelineScrollLeftPx = el.scrollLeft;
  }

  // Keep the store's scroll position in sync with the mobile scrollEl so ruler/grid/playhead align.
  watch(
    scrollEl,
    (el, _oldEl, onCleanup) => {
      if (!el) return;
      const onScroll = () => {
        timelineStore.timelineScrollLeftPx = el.scrollLeft;
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      nextTick(scrollPlayheadIntoView);
      onCleanup(() => el.removeEventListener('scroll', onScroll));
    },
    { immediate: true },
  );

  watch(
    () => timelineStore.scrollToPlayheadRequest,
    () => {
      nextTick(scrollPlayheadIntoView);
    },
  );

  return {
    scrollViewportWidth,
    scrollPlayheadIntoView,
  };
}
