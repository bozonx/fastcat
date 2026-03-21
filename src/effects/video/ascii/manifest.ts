import { AsciiFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface AsciiParams {
  size: number;
}

export const asciiManifest: EffectManifest<AsciiParams> = {
  type: 'ascii',
  name: 'ASCII Art',
  nameKey: 'fastcat.effects.video.ascii.name',
  description: 'ASCII symbols effect',
  descriptionKey: 'fastcat.effects.video.ascii.description',
  icon: 'i-heroicons-document-text',
  defaultValues: {
    size: 8,
  },
  controls: [
    {
      kind: 'slider',
      key: 'size',
      label: 'Размер',
      labelKey: 'fastcat.effects.video.ascii.params.size',
      min: 2,
      max: 64,
      step: 1,
    },
  ],
  createFilter: () => new AsciiFilter({ size: 8 }),
  updateFilter: (filter, values) => {
    const f = filter as AsciiFilter;
    if (values.size !== undefined) f.size = values.size;
  },
};
