import { CrossHatchFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export const crossHatchManifest: EffectManifest<{}> = {
  type: 'crossHatch',
  name: 'Cross Hatch',
  nameKey: 'fastcat.effects.video.crossHatch.name',
  description: 'Cross-hatching effect',
  descriptionKey: 'fastcat.effects.video.crossHatch.description',
  icon: 'i-heroicons-pencil-square',
  defaultValues: {},
  controls: [],
  createFilter: () => new CrossHatchFilter(),
  updateFilter: () => {},
};
