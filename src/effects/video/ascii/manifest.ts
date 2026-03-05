import { AsciiFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface AsciiParams {
  size: number;
}

export const asciiManifest: EffectManifest<AsciiParams> = {
  type: 'ascii',
  name: 'ASCII Art',
  description: 'Эффект ASCII символов',
  icon: 'i-heroicons-document-text',
  defaultValues: {
    size: 8,
  },
  controls: [
    {
      kind: 'slider',
      key: 'size',
      label: 'Размер',
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
