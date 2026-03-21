import { ColorMatrixFilter } from 'pixi.js';
import type { EffectManifest } from '../../core/registry';

export interface ColorMatrixParams {
  filterType:
    | 'none'
    | 'sepia'
    | 'negative'
    | 'blackAndWhite'
    | 'browni'
    | 'vintage'
    | 'kodachrome'
    | 'technicolor'
    | 'polaroid'
    | 'lsd';
  intensity: number;
}

export const colorMatrixManifest: EffectManifest<ColorMatrixParams> = {
  type: 'colorMatrix',
  name: 'Цветовой фильтр',
  nameKey: 'fastcat.effects.video.colorMatrix.name',
  description: 'Готовые цветовые пресеты',
  descriptionKey: 'fastcat.effects.video.colorMatrix.description',
  icon: 'i-heroicons-swatch',
  defaultValues: {
    filterType: 'none',
    intensity: 1,
  },
  controls: [
    {
      kind: 'select',
      key: 'filterType',
      label: 'Фильтр',
      labelKey: 'fastcat.effects.video.colorMatrix.params.filterType',
      options: [
        { label: 'Нет', value: 'none' },
        { label: 'Сепия', value: 'sepia' },
        { label: 'Негатив', value: 'negative' },
        { label: 'Ч/Б', value: 'blackAndWhite' },
        { label: 'Брауни', value: 'browni' },
        { label: 'Винтаж', value: 'vintage' },
        { label: 'Кодахром', value: 'kodachrome' },
        { label: 'Техниколор', value: 'technicolor' },
        { label: 'Полароид', value: 'polaroid' },
        { label: 'LSD', value: 'lsd' },
      ],
    },
    {
      kind: 'slider',
      key: 'intensity',
      label: 'Интенсивность',
      labelKey: 'fastcat.effects.video.colorMatrix.params.intensity',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
  ],
  createFilter: () => new ColorMatrixFilter(),
  updateFilter: (filter, values) => {
    const f = filter as ColorMatrixFilter;
    f.reset();
    f.alpha = values.intensity ?? 1;

    switch (values.filterType) {
      case 'sepia':
        f.sepia(false);
        break;
      case 'negative':
        f.negative(false);
        break;
      case 'blackAndWhite':
        f.blackAndWhite(false);
        break;
      case 'browni':
        f.browni(false);
        break;
      case 'vintage':
        f.vintage(false);
        break;
      case 'kodachrome':
        f.kodachrome(false);
        break;
      case 'technicolor':
        f.technicolor(false);
        break;
      case 'polaroid':
        f.polaroid(false);
        break;
      case 'lsd':
        f.lsd(false);
        break;
    }

    // Workaround for PixiJS v8 bug: some presets use 0-255 range for offsets instead of 0-1
    const m = [...f.matrix] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    let needsFix = false;
    // Check offsets (column 4)
    if (
      Math.abs(m[4] || 0) > 1 ||
      Math.abs(m[9] || 0) > 1 ||
      Math.abs(m[14] || 0) > 1 ||
      Math.abs(m[19] || 0) > 1
    ) {
      needsFix = true;
    }

    if (needsFix) {
      m[4] = (m[4] || 0) / 255;
      m[9] = (m[9] || 0) / 255;
      m[14] = (m[14] || 0) / 255;
      m[19] = (m[19] || 0) / 255;
      f.matrix = m as any;
    }
  },
};
