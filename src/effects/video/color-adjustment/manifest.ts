import { ColorMatrixFilter } from 'pixi.js';
import type { EffectManifest } from '../../core/registry';

export interface ColorAdjustmentParams {
  brightness: number;
  contrast: number;
  saturation: number;
}

export const colorAdjustmentManifest: EffectManifest<ColorAdjustmentParams> = {
  type: 'color-adjustment',
  name: 'Цветокоррекция',
  description: 'Настройка яркости, контрастности и насыщенности',
  icon: 'i-heroicons-swatch',
  defaultValues: {
    brightness: 1,
    contrast: 1,
    saturation: 1,
  },
  controls: [
    { kind: 'slider', key: 'brightness', label: 'Яркость', min: 0, max: 2, step: 0.05, format: (v) => `${Math.round((v - 1) * 100)}%` },
    { kind: 'slider', key: 'contrast', label: 'Контрастность', min: 0, max: 2, step: 0.05, format: (v) => `${Math.round((v - 1) * 100)}%` },
    { kind: 'slider', key: 'saturation', label: 'Насыщенность', min: 0, max: 2, step: 0.05, format: (v) => `${Math.round((v - 1) * 100)}%` },
  ],
  createFilter: () => new ColorMatrixFilter(),
  updateFilter: (filter, values) => {
    const f = filter as ColorMatrixFilter;
    f.reset();
    if (values.brightness !== undefined && values.brightness !== 1) f.brightness(values.brightness, true);
    if (values.contrast !== undefined && values.contrast !== 1) f.contrast(values.contrast, true);
    if (values.saturation !== undefined && values.saturation !== 1) f.saturate(values.saturation - 1, true);
  },
};
