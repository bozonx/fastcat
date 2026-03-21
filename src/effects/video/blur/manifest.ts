import { BlurFilter } from 'pixi.js';
import type { EffectManifest } from '../../core/registry';

export interface BlurParams {
  strength: number;
  quality: number;
}

export const blurManifest: EffectManifest<BlurParams> = {
  type: 'blur',
  name: 'Blur',
  nameKey: 'fastcat.effects.video.blur.name',
  description: 'Gaussian blur',
  descriptionKey: 'fastcat.effects.video.blur.description',
  icon: 'i-heroicons-sparkles',
  defaultValues: {
    strength: 5,
    quality: 4,
  },
  controls: [
    {
      kind: 'slider',
      key: 'strength',
      label: 'Strength',
      labelKey: 'fastcat.effects.video.blur.params.strength',
      min: 0,
      max: 50,
      step: 1,
      format: (v) => `${v}px`,
    },
    {
      kind: 'slider',
      key: 'quality',
      label: 'Quality',
      labelKey: 'fastcat.effects.video.blur.params.quality',
      min: 1,
      max: 10,
      step: 1,
    },
  ],
  createFilter: () => new BlurFilter(5, 4),
  updateFilter: (filter, values) => {
    const f = filter as BlurFilter;
    if (values.strength !== undefined) {
      f.blur = values.strength;
    }
    if (values.quality !== undefined) {
      f.quality = values.quality;
    }
  },
};
