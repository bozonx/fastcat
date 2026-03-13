import type { Ref } from 'vue';
import type { TimelineClipItem, ShapeType, ShapeConfig } from '~/timeline/types';

interface UseClipShapePropertiesOptions {
  clip: Ref<TimelineClipItem>;
  timelineStore: any;
}

export function useClipShapeProperties(options: UseClipShapePropertiesOptions) {
  const { clip, timelineStore } = options;

  function handleUpdateShapeType(val: ShapeType) {
    if (clip.value.clipType !== 'shape') return;
    timelineStore.updateClipProperties(clip.value.trackId, clip.value.id, {
      shapeType: val,
    });
  }

  function handleUpdateFillColor(val: string) {
    if (clip.value.clipType !== 'shape') return;
    timelineStore.updateClipProperties(clip.value.trackId, clip.value.id, {
      fillColor: val,
    });
  }

  function handleUpdateStrokeColor(val: string) {
    if (clip.value.clipType !== 'shape') return;
    timelineStore.updateClipProperties(clip.value.trackId, clip.value.id, {
      strokeColor: val,
    });
  }

  function handleUpdateStrokeWidth(val: number) {
    if (clip.value.clipType !== 'shape') return;
    timelineStore.updateClipProperties(clip.value.trackId, clip.value.id, {
      strokeWidth: val,
    });
  }

  function handleUpdateShapeConfig(configUpdate: Partial<ShapeConfig>) {
    if (clip.value.clipType !== 'shape') return;
    const currentConfig =
      (clip.value as import('~/timeline/types').TimelineShapeClipItem).shapeConfig || {};
    timelineStore.updateClipProperties(clip.value.trackId, clip.value.id, {
      shapeConfig: { ...currentConfig, ...configUpdate },
    } as any);
  }

  return {
    handleUpdateShapeType,
    handleUpdateFillColor,
    handleUpdateStrokeColor,
    handleUpdateStrokeWidth,
    handleUpdateShapeConfig,
  };
}
