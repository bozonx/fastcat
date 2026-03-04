import { BlurFilter } from 'pixi.js';
import type { EffectManifest } from '../../core/registry';

export interface BlurParams {
  strength: number;
  quality: number;
}

export const blurManifest: EffectManifest<BlurParams> = {
  type: 'blur',
  name: 'Размытие',
  description: 'Размытие по Гауссу',
  icon: 'i-heroicons-sparkles',
  defaultValues: {
    strength: 5,
    quality: 4,
  },
  controls: [
    {
      kind: 'slider',
      key: 'strength',
      label: 'Сила',
      min: 0,
      max: 50,
      step: 1,
      format: (v) => `${v}px`,
    },
    {
      kind: 'slider',
      key: 'quality',
      label: 'Качество',
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
