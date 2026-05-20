import { BloomFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface BloomParams {
  strength: number;
  quality: number;
}

export const bloomManifest: EffectManifest<BloomParams> = {
  type: 'bloom',
  name: 'Bloom',
  nameKey: 'fastcat.effects.video.bloom.name',
  description: 'Soft bloom effect',
  descriptionKey: 'fastcat.effects.video.bloom.description',
  icon: 'i-heroicons-sparkles',
  defaultValues: {
    strength: 2,
    quality: 4,
  },
  controls: [
    {
      kind: 'slider',
      key: 'strength',
      label: 'Strength',
      labelKey: 'fastcat.effects.video.bloom.params.strength',
      min: 0,
      max: 20,
      step: 0.5,
    },
    {
      kind: 'slider',
      key: 'quality',
      label: 'Quality',
      labelKey: 'fastcat.effects.video.bloom.params.quality',
      min: 1,
      max: 10,
      step: 1,
    },
  ],
  createFilter: () => new BloomFilter({ strength: 2, quality: 4 }),
  updateFilter: (filter, values) => {
    const f = filter as BloomFilter & {
      _blurXFilter?: { quality: number };
      _blurYFilter?: { quality: number };
    };
    if (values.strength !== undefined) f.strength = values.strength;
    if (values.quality !== undefined) {
      if (f._blurXFilter) f._blurXFilter.quality = values.quality;
      if (f._blurYFilter) f._blurYFilter.quality = values.quality;
    }
  },
};
