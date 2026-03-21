import { DotFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface DotParams {
  scale: number;
  angle: number;
  grayscale: boolean;
}

export const dotManifest: EffectManifest<DotParams> = {
  type: 'dot',
  name: 'Точки (Полутон)',
  nameKey: 'fastcat.effects.video.dot.name',
  description: 'Эффект растровой печати',
  descriptionKey: 'fastcat.effects.video.dot.description',
  icon: 'i-heroicons-dots-circle-horizontal',
  defaultValues: {
    scale: 1,
    angle: 5,
    grayscale: true,
  },
  controls: [
    {
      kind: 'slider',
      key: 'scale',
      label: 'Масштаб',
      labelKey: 'fastcat.effects.video.dot.params.scale',
      min: 0.1,
      max: 10,
      step: 0.1,
    },
    {
      kind: 'slider',
      key: 'angle',
      label: 'Угол',
      labelKey: 'fastcat.effects.video.dot.params.angle',
      min: 0,
      max: 360,
      step: 1,
      format: (v) => `${v}°`,
    },
    {
      kind: 'toggle',
      key: 'grayscale',
      label: 'Ч/Б',
      labelKey: 'fastcat.effects.video.dot.params.grayscale',
    },
  ],
  createFilter: () =>
    new DotFilter({
      scale: 1,
      angle: 5,
      grayscale: true,
    }),
  updateFilter: (filter, values) => {
    const f = filter as DotFilter;
    if (values.scale !== undefined) f.scale = values.scale;
    if (values.angle !== undefined) f.angle = values.angle;
    if (values.grayscale !== undefined) f.grayscale = values.grayscale;
  },
};
