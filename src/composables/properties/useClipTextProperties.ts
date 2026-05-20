import type { Ref } from 'vue';
import type { TimelineClipItem, TextClipStyle, TimelineTextClipItem } from '~/timeline/types';
import type { TimelineClipsModule } from '~/stores/timeline/clips';

interface UseClipTextPropertiesOptions {
  clip: Ref<TimelineClipItem>;
  timelineStore: TimelineClipsModule;
}

export function useClipTextProperties(options: UseClipTextPropertiesOptions) {
  const { clip, timelineStore } = options;

  function handleUpdateText(val: string | undefined) {
    if (clip.value.clipType !== 'text') return;
    timelineStore.updateClipProperties(clip.value.trackId, clip.value.id, {
      text: typeof val === 'string' ? val : '',
    });
  }

  function handleUpdateTextStyle(patch: Partial<TextClipStyle>) {
    if (clip.value.clipType !== 'text') return;
    const curr = ((clip.value as TimelineTextClipItem).style ?? {}) as TextClipStyle;
    timelineStore.updateClipProperties(clip.value.trackId, clip.value.id, {
      style: {
        ...curr,
        ...patch,
      },
    });
  }

  return {
    handleUpdateText,
    handleUpdateTextStyle,
  };
}
