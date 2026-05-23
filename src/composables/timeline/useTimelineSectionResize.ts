import { ref, onBeforeUnmount, watch, type Ref } from 'vue';
import { getPlatformSuffix } from '~/stores/ui/uiLocalStorage';

const DEFAULT_VIDEO_SECTION_PERCENT = 60;

export interface UseTimelineSectionResizeOptions {
  projectId: Ref<string | null | undefined>;
  storage?: {
    get: (key: string) => number | null | undefined;
    set: (key: string, value: number) => void;
  };
}

export function useTimelineSectionResize({ projectId, storage }: UseTimelineSectionResizeOptions) {
  const getStorageKey = () =>
    `fastcat-timeline-video-section-${projectId.value}${getPlatformSuffix()}`;
  const videoSectionPercent = ref(storage?.get(getStorageKey()) ?? DEFAULT_VIDEO_SECTION_PERCENT);

  // Track both the key and the stored value: project settings load
  // asynchronously after projectId is set, so watching the key alone would read
  // empty storage once and never pick up the persisted height on reload.
  watch(
    () => {
      const key = getStorageKey();
      return [key, storage?.get(key) ?? null] as const;
    },
    ([key]) => {
      videoSectionPercent.value = storage?.get(key) ?? DEFAULT_VIDEO_SECTION_PERCENT;
    },
    { immediate: true },
  );

  watch(videoSectionPercent, (value) => {
    storage?.set(getStorageKey(), value);
  });

  const sectionContainerRef = ref<HTMLElement | null>(null);
  const isResizingSections = ref(false);
  const resizeSectionStartY = ref(0);
  const resizeSectionStartPercent = ref(0);

  function onSectionResizeMove(e: MouseEvent) {
    if (!isResizingSections.value || !sectionContainerRef.value) return;
    const containerHeight = sectionContainerRef.value.offsetHeight;
    if (containerHeight <= 0) return;
    const dy = e.clientY - resizeSectionStartY.value;
    const dpercent = (dy / containerHeight) * 100;
    videoSectionPercent.value = Math.max(
      10,
      Math.min(90, resizeSectionStartPercent.value + dpercent),
    );
  }

  function onSectionResizeEnd() {
    isResizingSections.value = false;
    window.removeEventListener('mousemove', onSectionResizeMove);
    window.removeEventListener('mouseup', onSectionResizeEnd);
  }

  function onSectionResizeStart(e: MouseEvent) {
    e.preventDefault();
    isResizingSections.value = true;
    resizeSectionStartY.value = e.clientY;
    resizeSectionStartPercent.value = videoSectionPercent.value;
    window.addEventListener('mousemove', onSectionResizeMove);
    window.addEventListener('mouseup', onSectionResizeEnd);
  }

  function resetSectionPercent() {
    videoSectionPercent.value = DEFAULT_VIDEO_SECTION_PERCENT;
  }

  onBeforeUnmount(() => {
    window.removeEventListener('mousemove', onSectionResizeMove);
    window.removeEventListener('mouseup', onSectionResizeEnd);
  });

  return {
    videoSectionPercent,
    sectionContainerRef,
    isResizingSections,
    onSectionResizeStart,
    resetSectionPercent,
  };
}
