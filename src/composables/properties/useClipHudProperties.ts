import { type Ref, computed } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import { getHudManifest } from '~/hud/registry';

interface UseClipHudPropertiesOptions {
  clip: Ref<TimelineClipItem>;
  timelineStore: any;
}

export function useClipHudProperties(options: UseClipHudPropertiesOptions) {
  const { clip, timelineStore } = options;

  const hudManifest = computed(() =>
    clip.value.clipType === 'hud' ? getHudManifest(clip.value.hudType) : undefined,
  );

  function flattenObject(ob: any, prefix = ''): Record<string, any> {
    const result: Record<string, any> = {};
    for (const i in ob) {
      if (!Object.prototype.hasOwnProperty.call(ob, i)) continue;
      if (typeof ob[i] === 'object' && ob[i] !== null && !Array.isArray(ob[i])) {
        const flatObject = flattenObject(ob[i], prefix + i + '.');
        for (const x in flatObject) {
          if (!Object.prototype.hasOwnProperty.call(flatObject, x)) continue;
          result[x] = flatObject[x];
        }
      } else {
        result[prefix + i] = ob[i];
      }
    }
    return result;
  }

  const hudControlValues = computed<Record<string, any>>(() => {
    if (clip.value.clipType !== 'hud') return {};
    return {
      hudType: clip.value.hudType,
      ...flattenObject({ background: clip.value.background || {} }),
      ...flattenObject({ content: clip.value.content || {} }),
      ...flattenObject({ frame: clip.value.frame || {} }),
    };
  });

  function handleUpdateHudControl(key: string, value: any) {
    if (clip.value.clipType !== 'hud') return;

    const keys = key.split('.');
    if (keys[0] !== 'background' && keys[0] !== 'content' && keys[0] !== 'frame') {
      return;
    }

    const layer = keys[0] as 'background' | 'content' | 'frame';

    // Read from the store directly to get the latest committed state.
    // clip.value is a Vue prop that updates asynchronously through re-renders,
    // so rapid successive calls within the same tick would read stale data.
    const liveTrack = timelineStore.timelineDoc?.tracks?.find(
      (t: any) => t.id === clip.value.trackId,
    );
    const liveClip = liveTrack?.items?.find(
      (it: any) => it.kind === 'clip' && it.id === clip.value.id,
    );
    const layerSource = liveClip ?? clip.value;
    const current = JSON.parse(JSON.stringify((layerSource as any)[layer] ?? {}));

    let target = current;
    for (let i = 1; i < keys.length - 1; i++) {
      const k = keys[i] as string;
      if (!target[k]) target[k] = {};
      target = target[k];
    }

    // For paths (empty string -> undefined)
    const lastKey = keys[keys.length - 1] as string;
    if (lastKey === 'path' && typeof value === 'string' && !value.trim()) {
      target[lastKey] = undefined;
    } else {
      target[lastKey] = value;
    }

    timelineStore.updateClipProperties(clip.value.trackId, clip.value.id, {
      [layer]: current,
    });
  }

  return {
    hudManifest,
    hudControlValues,
    handleUpdateHudControl,
  };
}
