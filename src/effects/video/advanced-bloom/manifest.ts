import { AdvancedBloomFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface AdvancedBloomParams {
  threshold: number;
  bloomScale: number;
  brightness: number;
  blur: number;
  quality: number;
}

export const advancedBloomManifest: EffectManifest<AdvancedBloomParams> = {
  type: 'advancedBloom',
  name: 'Свечение (Продвинутое)',
  nameKey: 'fastcat.effects.video.advancedBloom.name',
  description: 'Продвинутый эффект свечения с настройкой порога и яркости',
  descriptionKey: 'fastcat.effects.video.advancedBloom.description',
  icon: 'i-heroicons-sparkles',
  defaultValues: {
    threshold: 0.5,
    bloomScale: 1.0,
    brightness: 1.0,
    blur: 2.0,
    quality: 4,
  },
  controls: [
    {
      kind: 'slider',
      key: 'threshold',
      label: 'Порог',
      labelKey: 'fastcat.effects.video.advancedBloom.params.threshold',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'bloomScale',
      label: 'Сила свечения',
      labelKey: 'fastcat.effects.video.advancedBloom.params.bloomScale',
      min: 0,
      max: 5,
      step: 0.1,
    },
    {
      kind: 'slider',
      key: 'brightness',
      label: 'Яркость',
      labelKey: 'fastcat.effects.video.advancedBloom.params.brightness',
      min: 0,
      max: 5,
      step: 0.1,
    },
    {
      kind: 'slider',
      key: 'blur',
      label: 'Размытие',
      labelKey: 'fastcat.effects.video.advancedBloom.params.blur',
      min: 0,
      max: 20,
      step: 0.5,
    },
    {
      kind: 'slider',
      key: 'quality',
      label: 'Качество',
      labelKey: 'fastcat.effects.video.advancedBloom.params.quality',
      min: 1,
      max: 10,
      step: 1,
    },
  ],
  createFilter: () =>
    new AdvancedBloomFilter({
      threshold: 0.5,
      bloomScale: 1.0,
      brightness: 1.0,
      blur: 2.0,
      quality: 4,
    }),
  updateFilter: (filter, values) => {
    const f = filter as AdvancedBloomFilter;
    if (values.threshold !== undefined) f.threshold = values.threshold;
    if (values.bloomScale !== undefined) f.bloomScale = values.bloomScale;
    if (values.brightness !== undefined) f.brightness = values.brightness;
    if (values.blur !== undefined) f.blur = values.blur;
    if (values.quality !== undefined) f.quality = values.quality;
  },
};
