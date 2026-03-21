import { BackdropBlurFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface BackdropBlurParams {
  strength: number;
  quality: number;
}

export const backdropBlurManifest: EffectManifest<BackdropBlurParams> = {
  type: 'backdropBlur',
  name: 'Размытие фона',
  nameKey: 'fastcat.effects.video.backdropBlur.name',
  description: 'Размытие всего, что находится позади объекта',
  descriptionKey: 'fastcat.effects.video.backdropBlur.description',
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
      labelKey: 'fastcat.effects.video.backdropBlur.params.strength',
      min: 0,
      max: 50,
      step: 1,
      format: (v) => `${v}px`,
    },
    {
      kind: 'slider',
      key: 'quality',
      label: 'Качество',
      labelKey: 'fastcat.effects.video.backdropBlur.params.quality',
      min: 1,
      max: 10,
      step: 1,
    },
  ],
  createFilter: () => new BackdropBlurFilter({ strength: 5, quality: 4 }),
  updateFilter: (filter, values) => {
    const f = filter as BackdropBlurFilter;
    if (values.strength !== undefined) f.blur = values.strength; // backdrop blur extends BlurFilter
    if (values.quality !== undefined) f.quality = values.quality;
  },
};
