import { BlurFilter } from 'pixi.js';
import type { EffectManifest } from '../../core/registry';

export interface BlurParams {
  strength: number;
}

export const blurManifest: EffectManifest<BlurParams> = {
  type: 'blur',
  name: 'Размытие',
  description: 'Размытие по Гауссу',
  icon: 'i-heroicons-sparkles',
  defaultValues: {
    strength: 5,
  },
  controls: [
    { kind: 'slider', key: 'strength', label: 'Сила', min: 0, max: 50, step: 1, format: (v) => `${v}px` },
  ],
  createFilter: () => new BlurFilter(5),
  updateFilter: (filter, values) => {
    const f = filter as BlurFilter;
    if (values.strength !== undefined) {
      f.blur = values.strength;
    }
  },
};
