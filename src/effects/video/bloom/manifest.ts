import { BloomFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface BloomParams {
  strength: number;
  quality: number;
}

export const bloomManifest: EffectManifest<BloomParams> = {
  type: 'bloom',
  name: 'Свечение (Bloom)',
  description: 'Эффект размытого свечения',
  icon: 'i-heroicons-sparkles',
  defaultValues: {
    strength: 2,
    quality: 4,
  },
  controls: [
    {
      kind: 'slider',
      key: 'strength',
      label: 'Сила',
      min: 0,
      max: 20,
      step: 0.5,
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
  createFilter: () => new BloomFilter({ strength: 2, quality: 4 }),
  updateFilter: (filter, values) => {
    const f = filter as BloomFilter;
    if (values.strength !== undefined) f.strength = values.strength;
    if (values.quality !== undefined) f.quality = values.quality;
  },
};
