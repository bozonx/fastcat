import { BevelFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface BevelParams {
  rotation: number;
  thickness: number;
  lightAlpha: number;
  shadowAlpha: number;
}

export const bevelManifest: EffectManifest<BevelParams> = {
  type: 'bevel',
  name: 'Скос (Фаска)',
  nameKey: 'fastcat.effects.video.bevel.name',
  description: 'Эффект объемной рамки (фаски)',
  descriptionKey: 'fastcat.effects.video.bevel.description',
  icon: 'i-heroicons-cube',
  defaultValues: {
    rotation: 45,
    thickness: 2,
    lightAlpha: 0.7,
    shadowAlpha: 0.7,
  },
  controls: [
    {
      kind: 'slider',
      key: 'rotation',
      label: 'Угол',
      labelKey: 'fastcat.effects.video.bevel.params.rotation',
      min: 0,
      max: 360,
      step: 1,
      format: (v) => `${v}°`,
    },
    {
      kind: 'slider',
      key: 'thickness',
      label: 'Толщина',
      labelKey: 'fastcat.effects.video.bevel.params.thickness',
      min: 0,
      max: 20,
      step: 1,
    },
    {
      kind: 'slider',
      key: 'lightAlpha',
      label: 'Прозрачность света',
      labelKey: 'fastcat.effects.video.bevel.params.lightAlpha',
      min: 0,
      max: 1,
      step: 0.05,
    },
    {
      kind: 'slider',
      key: 'shadowAlpha',
      label: 'Прозрачность тени',
      labelKey: 'fastcat.effects.video.bevel.params.shadowAlpha',
      min: 0,
      max: 1,
      step: 0.05,
    },
  ],
  createFilter: () =>
    new BevelFilter({
      rotation: 45,
      thickness: 2,
      lightAlpha: 0.7,
      shadowAlpha: 0.7,
    }),
  updateFilter: (filter, values) => {
    const f = filter as BevelFilter;
    if (values.rotation !== undefined) f.rotation = values.rotation;
    if (values.thickness !== undefined) f.thickness = values.thickness;
    if (values.lightAlpha !== undefined) f.lightAlpha = values.lightAlpha;
    if (values.shadowAlpha !== undefined) f.shadowAlpha = values.shadowAlpha;
  },
};
