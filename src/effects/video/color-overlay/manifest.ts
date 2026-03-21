import { ColorOverlayFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface ColorOverlayParams {
  color: string;
  alpha: number;
}

export const colorOverlayManifest: EffectManifest<ColorOverlayParams> = {
  type: 'colorOverlay',
  name: 'Color Overlay',
  nameKey: 'fastcat.effects.video.colorOverlay.name',
  description: 'Fill with solid color',
  descriptionKey: 'fastcat.effects.video.colorOverlay.description',
  icon: 'i-heroicons-paint-brush',
  defaultValues: {
    color: '#000000',
    alpha: 0.5,
  },
  controls: [
    // TODO: Add color picker control type to EffectControl
    {
      kind: 'slider',
      key: 'alpha',
      label: 'Opacity',
      labelKey: 'fastcat.effects.video.colorOverlay.params.alpha',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
  ],
  createFilter: () =>
    new ColorOverlayFilter({
      color: 0x000000,
      alpha: 0.5,
    }),
  updateFilter: (filter, values) => {
    const f = filter as ColorOverlayFilter;
    if (values.color !== undefined) {
      // Parse hex string to number
      const hex = values.color.replace('#', '');
      f.color = parseInt(hex, 16);
    }
    if (values.alpha !== undefined) f.alpha = values.alpha;
  },
};
