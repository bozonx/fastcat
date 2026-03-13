import type { Ref } from 'vue';
import type { TimelineClipItem, TextClipStyle } from '~/timeline/types';

interface UseClipTextPropertiesOptions {
  clip: Ref<TimelineClipItem>;
  timelineStore: any;
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
    const curr = ((clip.value as any).style ?? {}) as TextClipStyle;
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
