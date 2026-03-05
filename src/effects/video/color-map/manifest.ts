import { ColorMapFilter } from 'pixi-filters';
import { Texture } from 'pixi.js';
import type { EffectManifest } from '../../core/registry';

export interface ColorMapParams {
  mix: number;
  nearest: boolean;
}

export const colorMapManifest: EffectManifest<ColorMapParams> = {
  type: 'colorMap',
  name: 'Цветовая карта',
  description: 'Применение цветовой карты (LUT)',
  icon: 'i-heroicons-map',
  defaultValues: {
    mix: 1,
    nearest: false,
  },
  controls: [
    {
      kind: 'slider',
      key: 'mix',
      label: 'Интенсивность',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'toggle',
      key: 'nearest',
      label: 'Режим Nearest',
    },
  ],
  createFilter: () => {
    // Create a dummy texture for the color map to prevent crash on init
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      for (let i = 0; i < 256; i++) {
        ctx.fillStyle = `rgb(${i},${i},${i})`;
        ctx.fillRect(i, 0, 1, 16);
      }
    }
    return new ColorMapFilter({
      colorMap: Texture.from(canvas),
      mix: 1,
      nearest: false,
    });
  },
  updateFilter: (filter, values) => {
    const f = filter as ColorMapFilter;
    if (values.mix !== undefined) f.mix = values.mix;
    if (values.nearest !== undefined) f.nearest = values.nearest;
  },
};
