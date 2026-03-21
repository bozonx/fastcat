import { DropShadowFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface DropShadowParams {
  offsetX: number;
  offsetY: number;
  color: string;
  alpha: number;
  shadowOnly: boolean;
  blur: number;
  quality: number;
}

export const dropShadowManifest: EffectManifest<DropShadowParams> = {
  type: 'dropShadow',
  name: 'Shadow',
  nameKey: 'fastcat.effects.video.dropShadow.name',
  description: 'Drop shadow effect',
  descriptionKey: 'fastcat.effects.video.dropShadow.description',
  icon: 'i-heroicons-squares-plus',
  defaultValues: {
    offsetX: 4,
    offsetY: 4,
    color: '#000000',
    alpha: 1,
    shadowOnly: false,
    blur: 2,
    quality: 4,
  },
  controls: [
    {
      kind: 'slider',
      key: 'offsetX',
      label: 'Offset X',
      labelKey: 'fastcat.effects.video.dropShadow.params.offsetX',
      min: -50,
      max: 50,
      step: 1,
      format: (v) => `${v}px`,
    },
    {
      kind: 'slider',
      key: 'offsetY',
      label: 'Offset Y',
      labelKey: 'fastcat.effects.video.dropShadow.params.offsetY',
      min: -50,
      max: 50,
      step: 1,
      format: (v) => `${v}px`,
    },
    {
      kind: 'slider',
      key: 'alpha',
      label: 'Opacity',
      labelKey: 'fastcat.effects.video.dropShadow.params.alpha',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'blur',
      label: 'Blur',
      labelKey: 'fastcat.effects.video.dropShadow.params.blur',
      min: 0,
      max: 20,
      step: 0.5,
    },
    {
      kind: 'slider',
      key: 'quality',
      label: 'Quality',
      labelKey: 'fastcat.effects.video.dropShadow.params.quality',
      min: 1,
      max: 10,
      step: 1,
    },
    {
      kind: 'toggle',
      key: 'shadowOnly',
      label: 'Shadow Only',
      labelKey: 'fastcat.effects.video.dropShadow.params.shadowOnly',
    },
  ],
  createFilter: () =>
    new DropShadowFilter({
      offset: { x: 4, y: 4 },
      color: 0x000000,
      alpha: 1,
      shadowOnly: false,
      blur: 2,
      quality: 4,
    }),
  updateFilter: (filter, values) => {
    const f = filter as DropShadowFilter;
    if (values.offsetX !== undefined && values.offsetY !== undefined) {
      f.offset = { x: values.offsetX, y: values.offsetY };
    }
    if (values.color !== undefined) {
      f.color = parseInt(values.color.replace('#', ''), 16);
    }
    if (values.alpha !== undefined) f.alpha = values.alpha;
    if (values.shadowOnly !== undefined) f.shadowOnly = values.shadowOnly;
    if (values.blur !== undefined) f.blur = values.blur;
    if (values.quality !== undefined) f.quality = values.quality;
  },
};
