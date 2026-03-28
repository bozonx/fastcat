import { ref, watch, type Ref } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { useTimelineStore } from '~/stores/timeline.store';

export interface UseTimelineHorizontalScrollSyncElements {
  video: Ref<HTMLElement | null>;
  audio: Ref<HTMLElement | null>;
  ruler: Ref<HTMLElement | null>;
  videoLabels: Ref<HTMLElement | null>;
  audioLabels: Ref<HTMLElement | null>;
}

export function useTimelineHorizontalScrollSync(els: UseTimelineHorizontalScrollSyncElements) {
  const timelineStore = useTimelineStore();

  const scrollLeftRef = ref(0);
  const scrollbarHeight = ref(0);
  const viewportWidth = ref(0);

  let isSyncingHorizontal = false;

  function syncHorizontal(source: HTMLElement) {
    if (isSyncingHorizontal) return;
    isSyncingHorizontal = true;
    requestAnimationFrame(() => {
      const sl = source.scrollLeft;
      const targets = [els.video.value, els.audio.value, els.ruler.value];
      for (const el of targets) {
        if (el && el !== source && el.scrollLeft !== sl) {
          el.scrollLeft = sl;
        }
      }
      scrollLeftRef.value = sl;
      isSyncingHorizontal = false;
    });
  }

  function onVideoScroll() {
    if (!els.video.value) return;
    syncHorizontal(els.video.value);
    if (els.videoLabels.value) {
      els.videoLabels.value.scrollTop = els.video.value.scrollTop;
    }
  }

  function onAudioScroll() {
    if (!els.audio.value) return;
    syncHorizontal(els.audio.value);
    if (els.audioLabels.value) {
      els.audioLabels.value.scrollTop = els.audio.value.scrollTop;
    }
  }

  function onRulerScroll() {
    if (els.ruler.value) syncHorizontal(els.ruler.value);
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

  // Track scrollbar height from the audio section (only one with visible horizontal scrollbar)
  useResizeObserver(els.audio, () => {
    if (!els.audio.value) return;
    scrollbarHeight.value = els.audio.value.offsetHeight - els.audio.value.clientHeight;
    viewportWidth.value = els.audio.value.clientWidth;
    timelineStore.timelineViewportWidth = viewportWidth.value;
  });

  watch(
    () => timelineStore.scrollResetTicket,
    () => {
      for (const el of [els.video.value, els.audio.value, els.ruler.value]) {
        if (el) el.scrollLeft = 0;
      }
    },
  );

  return {
    scrollLeftRef,
    scrollbarHeight,
    viewportWidth,
    onVideoScroll,
    onAudioScroll,
    onRulerScroll,
    onVideoLabelsScroll,
    onAudioLabelsScroll,
  };
}
