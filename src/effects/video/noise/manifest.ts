import { NoiseFilter } from 'pixi.js';
import type { EffectManifest } from '../../core/registry';

export interface NoiseParams {
  noise: number;
  seed: number;
}

export const noiseManifest: EffectManifest<NoiseParams> = {
  type: 'noise',
  name: 'Шум',
  description: 'Эффект зернистости пленки',
  icon: 'i-heroicons-sparkles',
  defaultValues: {
    noise: 0.5,
    seed: 0.5,
  },
  controls: [
    {
      kind: 'slider',
      key: 'noise',
      label: 'Интенсивность',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'seed',
      label: 'Зерно',
      min: 0,
      max: 1,
      step: 0.01,
    },
  ],
  createFilter: () => new NoiseFilter(),
  updateFilter: (filter, values) => {
    const f = filter as NoiseFilter;
    if (values.noise !== undefined) {
      f.noise = values.noise;
    }
    if (values.seed !== undefined) {
      f.seed = values.seed;
    }
  },
};
