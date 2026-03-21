import { ConvolutionFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface ConvolutionParams {
  width: number;
  height: number;
}

export const convolutionManifest: EffectManifest<ConvolutionParams> = {
  type: 'convolution',
  name: 'Convolution',
  nameKey: 'fastcat.effects.video.convolution.name',
  description: 'Apply convolution matrix',
  descriptionKey: 'fastcat.effects.video.convolution.description',
  icon: 'i-heroicons-view-columns',
  defaultValues: {
    width: 200,
    height: 200,
  },
  controls: [
    {
      kind: 'slider',
      key: 'width',
      label: 'Width',
      labelKey: 'fastcat.effects.video.convolution.params.width',
      min: 1,
      max: 2000,
      step: 1,
    },
    {
      kind: 'slider',
      key: 'height',
      label: 'Height',
      labelKey: 'fastcat.effects.video.convolution.params.height',
      min: 1,
      max: 2000,
      step: 1,
    },
  ],
  createFilter: () => {
    // Default matrix (identity)
    return new ConvolutionFilter({
      matrix: [0, 0, 0, 0, 1, 0, 0, 0, 0],
      width: 200,
      height: 200,
    });
  },
  updateFilter: (filter, values) => {
    const f = filter as ConvolutionFilter;
    if (values.width !== undefined) f.width = values.width;
    if (values.height !== undefined) f.height = values.height;
  },
};
