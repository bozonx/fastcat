import { ColorGradientFilter, type ColorStop } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface ColorGradientParams {
  type: number;
  angle: number;
  alpha: number;
  maxColors: number;
  replace: boolean;
}

export const colorGradientManifest: EffectManifest<ColorGradientParams> = {
  type: 'colorGradient',
  name: 'Color Gradient',
  nameKey: 'fastcat.effects.video.colorGradient.name',
  description: 'Overlay color gradient',
  descriptionKey: 'fastcat.effects.video.colorGradient.description',
  icon: 'i-heroicons-swatch',
  defaultValues: {
    type: 0, // Linear
    angle: 90,
    alpha: 1,
    maxColors: 0,
    replace: false,
  },
  controls: [
    {
      kind: 'select',
      key: 'type',
      label: 'Type',
      labelKey: 'fastcat.effects.video.colorGradient.params.type',
      options: [
        { label: 'Linear', labelKey: 'fastcat.effects.video.colorGradient.options.linear', value: 0 },
        { label: 'Radial', labelKey: 'fastcat.effects.video.colorGradient.options.radial', value: 1 },
        { label: 'Conic', labelKey: 'fastcat.effects.video.colorGradient.options.conic', value: 2 },
      ],
    },
    {
      kind: 'slider',
      key: 'angle',
      label: 'Angle',
      labelKey: 'fastcat.effects.video.colorGradient.params.angle',
      min: 0,
      max: 360,
      step: 1,
      format: (v) => `${v}°`,
    },
    {
      kind: 'slider',
      key: 'alpha',
      label: 'Opacity',
      labelKey: 'fastcat.effects.video.colorGradient.params.alpha',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'maxColors',
      label: 'Color count (0=Unlimited)',
      labelKey: 'fastcat.effects.video.colorGradient.params.maxColors',
      min: 0,
      max: 256,
      step: 1,
    },
    {
      kind: 'toggle',
      key: 'replace',
      label: 'Replace color',
      labelKey: 'fastcat.effects.video.colorGradient.params.replace',
    },
  ],
  createFilter: () => {
    // Default gradient stops (red to blue)
    const stops: ColorStop[] = [
      { offset: 0, color: 0xff0000, alpha: 1 },
      { offset: 1, color: 0x0000ff, alpha: 1 },
    ];
    return new ColorGradientFilter({
      type: 0,
      stops,
      angle: 90,
      alpha: 1,
      maxColors: 0,
      replace: false,
    });
  },
  updateFilter: (filter, values) => {
    const f = filter as ColorGradientFilter;
    if (values.type !== undefined) f.type = values.type;
    if (values.angle !== undefined) f.angle = values.angle;
    if (values.alpha !== undefined) f.alpha = values.alpha;
    if (values.maxColors !== undefined) f.maxColors = values.maxColors;
    if (values.replace !== undefined) f.replace = values.replace;
  },
};
