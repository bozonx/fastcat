import { CrossHatchFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export const crossHatchManifest: EffectManifest<{}> = {
  type: 'crossHatch',
  name: 'Штриховка',
  description: 'Эффект перекрестной штриховки',
  icon: 'i-heroicons-pencil-square',
  defaultValues: {},
  controls: [],
  createFilter: () => new CrossHatchFilter(),
  updateFilter: () => {},
};
