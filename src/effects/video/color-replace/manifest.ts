import { ColorReplaceFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface ColorReplaceParams {
  originalColor: string;
  targetColor: string;
  tolerance: number;
}

export const colorReplaceManifest: EffectManifest<ColorReplaceParams> = {
  type: 'colorReplace',
  name: 'Color Replace',
  nameKey: 'fastcat.effects.video.colorReplace.name',
  description: 'Replace one color with another',
  descriptionKey: 'fastcat.effects.video.colorReplace.description',
  icon: 'i-heroicons-arrow-path',
  defaultValues: {
    originalColor: '#ff0000',
    targetColor: '#000000',
    tolerance: 0.4,
  },
  controls: [
    // TODO: Add color picker controls
    {
      kind: 'slider',
      key: 'tolerance',
      label: 'Tolerance',
      labelKey: 'fastcat.effects.video.colorReplace.params.tolerance',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
  ],
  createFilter: () =>
    new ColorReplaceFilter({
      originalColor: 0xff0000,
      targetColor: 0x000000,
      tolerance: 0.4,
    }),
  updateFilter: (filter, values) => {
    const f = filter as ColorReplaceFilter;
    if (values.originalColor !== undefined) {
      f.originalColor = parseInt(values.originalColor.replace('#', ''), 16);
    }
    if (values.targetColor !== undefined) {
      f.targetColor = parseInt(values.targetColor.replace('#', ''), 16);
    }
    if (values.tolerance !== undefined) f.tolerance = values.tolerance;
  },
};
