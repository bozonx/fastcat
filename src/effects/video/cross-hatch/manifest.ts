import { CrossHatchFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export const crossHatchManifest: EffectManifest<{}> = {
  type: 'crossHatch',
  name: 'Штриховка',
  nameKey: 'fastcat.effects.video.crossHatch.name',
  description: 'Эффект перекрестной штриховки',
  descriptionKey: 'fastcat.effects.video.crossHatch.description',
  icon: 'i-heroicons-pencil-square',
  defaultValues: {},
  controls: [],
  createFilter: () => new CrossHatchFilter(),
  updateFilter: () => {},
};
