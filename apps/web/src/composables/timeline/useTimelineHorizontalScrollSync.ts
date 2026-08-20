import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { useTimelineStore } from '~/stores/timeline.store';

export interface UseTimelineHorizontalScrollSyncElements {
  master: Ref<HTMLElement | null>;
  videoLabels: Ref<HTMLElement | null>;
  audioLabels: Ref<HTMLElement | null>;
  video: Ref<HTMLElement | null>;
  audio: Ref<HTMLElement | null>;
}

export function useTimelineHorizontalScrollSync(els: UseTimelineHorizontalScrollSyncElements) {
  const timelineStore = useTimelineStore();

  // Single source of truth lives in the store so ruler/grid/playhead/tracks never disagree.
  const scrollLeftRef = computed({
    get: () => timelineStore.timelineScrollLeftPx,
    set: (v: number) => {
      timelineStore.timelineScrollLeftPx = v;
    },
  });
  const scrollbarHeight = ref(0);
  const viewportWidth = ref(0);

  // Scroll events fire faster than once per frame on precision touchpads/mice.
  // Writing the reactive scrollLeft synchronously on each event re-runs the whole
  // virtualization/thumbnail/ruler/grid/playhead pipeline inside the scroll handler.
  // Coalesce to at most one store write per animation frame, deduped by value.
  let scrollRafId: number | null = null;
  let pendingScrollLeft: number | null = null;

  function flushScrollLeft() {
    scrollRafId = null;
    if (pendingScrollLeft === null) return;
    const next = pendingScrollLeft;
    pendingScrollLeft = null;
    if (timelineStore.timelineScrollLeftPx !== next) {
      timelineStore.timelineScrollLeftPx = next;
    }
  }

  function queueScrollLeft(scrollLeft: number) {
    pendingScrollLeft = scrollLeft;
    if (scrollRafId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      flushScrollLeft();
      return;
    }
    scrollRafId = requestAnimationFrame(flushScrollLeft);
  }

  function onMasterScroll() {
    if (!els.master.value) return;
    queueScrollLeft(els.master.value.scrollLeft);
  }

  onScopeDispose(() => {
    if (scrollRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(scrollRafId);
    }
    scrollRafId = null;
    pendingScrollLeft = null;
  });

  function onVideoScroll() {
    if (!els.video.value) return;
    if (els.videoLabels.value) {
      els.videoLabels.value.scrollTop = els.video.value.scrollTop;
    }
  }

  function onAudioScroll() {
    if (!els.audio.value) return;
    if (els.audioLabels.value) {
      els.audioLabels.value.scrollTop = els.audio.value.scrollTop;
    }
  }

  function onVideoLabelsScroll() {
    if (els.videoLabels.value && els.video.value) {
      els.video.value.scrollTop = els.videoLabels.value.scrollTop;
    }
  }

  function onAudioLabelsScroll() {
    if (els.audioLabels.value && els.audio.value) {
      els.audio.value.scrollTop = els.audioLabels.value.scrollTop;
    }
  }

  useResizeObserver(els.master, () => {
    if (!els.master.value) return;
    scrollbarHeight.value = els.master.value.offsetHeight - els.master.value.clientHeight;
    viewportWidth.value = els.master.value.clientWidth;
    timelineStore.timelineViewportWidth = viewportWidth.value;
  });

  watch(
    els.master,
    (el) => {
      if (!el) return;
      timelineStore.timelineScrollLeftPx = el.scrollLeft;
      scrollbarHeight.value = el.offsetHeight - el.clientHeight;
      viewportWidth.value = el.clientWidth;
      timelineStore.timelineViewportWidth = viewportWidth.value;
    },
    { immediate: true },
  );

  watch(
    () => timelineStore.scrollResetTicket,
    () => {
      // Drop any coalesced scroll write so it can't clobber the reset.
      pendingScrollLeft = null;
      if (els.master?.value) els.master.value.scrollLeft = 0;
      timelineStore.timelineScrollLeftPx = 0;
    },
  );

  return {
    scrollLeftRef,
    scrollbarHeight,
    viewportWidth,
    onMasterScroll,
    onVideoScroll,
    onAudioScroll,
    onVideoLabelsScroll,
    onAudioLabelsScroll,
  };
}
