import { type Ref, computed } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import { getHudManifest } from '~/hud/registry';

interface UseClipHudPropertiesOptions {
  clip: Ref<TimelineClipItem>;
  timelineStore: any;
}

export function useClipHudProperties(options: UseClipHudPropertiesOptions) {
  const { clip, timelineStore } = options;

  function handleUpdateHudBackgroundPath(path: string | undefined) {
    if (clip.value.clipType !== 'hud') return;
    const current = (clip.value as import('~/timeline/types').TimelineHudClipItem).background || {};
    timelineStore.updateClipProperties(clip.value.trackId, clip.value.id, {
      background: {
        ...current,
        source: path ? { path } : undefined,
      },
    });
  }

  function handleUpdateHudContentPath(path: string | undefined) {
    if (clip.value.clipType !== 'hud') return;
    const current = (clip.value as import('~/timeline/types').TimelineHudClipItem).content || {};
    timelineStore.updateClipProperties(clip.value.trackId, clip.value.id, {
      content: {
        ...current,
        source: path ? { path } : undefined,
      },
    });
  }

  const hudManifest = computed(() =>
    clip.value.clipType === 'hud' ? getHudManifest(clip.value.hudType) : undefined,
  );

  const hudControlValues = computed<Record<string, any>>(() => {
    if (clip.value.clipType !== 'hud') return {};

    return {
      hudType: clip.value.hudType,
      backgroundSourcePath: clip.value.background?.source?.path,
      contentSourcePath: clip.value.content?.source?.path,
    };
  });

  function handleUpdateHudControl(key: string, value: any) {
    if (clip.value.clipType !== 'hud') return;

    if (key === 'backgroundSourcePath') {
      handleUpdateHudBackgroundPath(typeof value === 'string' && value.trim() ? value : undefined);
      return;
    }

    if (key === 'contentSourcePath') {
      handleUpdateHudContentPath(typeof value === 'string' && value.trim() ? value : undefined);
    }
  }

  return {
    hudManifest,
    hudControlValues,
    handleUpdateHudControl,
  };
}
