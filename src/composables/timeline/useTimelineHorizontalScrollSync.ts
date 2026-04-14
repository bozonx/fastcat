import { ref, watch, type Ref } from 'vue';
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

  const scrollLeftRef = ref(0);
  const scrollbarHeight = ref(0);
  const viewportWidth = ref(0);

  function onMasterScroll() {
    if (!els.master.value) return;
    scrollLeftRef.value = els.master.value.scrollLeft;
  }

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
      scrollLeftRef.value = el.scrollLeft;
      scrollbarHeight.value = el.offsetHeight - el.clientHeight;
      viewportWidth.value = el.clientWidth;
      timelineStore.timelineViewportWidth = viewportWidth.value;
    },
    { immediate: true },
  );

  watch(
    () => timelineStore.scrollResetTicket,
    () => {
      if (els.master?.value) els.master.value.scrollLeft = 0;
      scrollLeftRef.value = 0;
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
