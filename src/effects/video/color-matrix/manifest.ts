import { ColorMatrixFilter } from 'pixi.js';
import type { EffectManifest } from '../../core/registry';

export interface ColorMatrixParams {
  filterType: 'none' | 'sepia' | 'negative' | 'blackAndWhite' | 'browni' | 'vintage' | 'kodachrome' | 'technicolor' | 'polaroid' | 'lsd';
}

export const colorMatrixManifest: EffectManifest<ColorMatrixParams> = {
  type: 'colorMatrix',
  name: 'Цветовой фильтр',
  description: 'Готовые цветовые пресеты',
  icon: 'i-heroicons-swatch',
  defaultValues: {
    filterType: 'none',
  },
  controls: [
    {
      kind: 'select',
      key: 'filterType',
      label: 'Фильтр',
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
  ],
  createFilter: () => new ColorMatrixFilter(),
  updateFilter: (filter, values) => {
    const f = filter as ColorMatrixFilter;
    f.reset();
    
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
  },
};
