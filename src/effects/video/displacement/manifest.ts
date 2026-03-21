import { DisplacementFilter, Sprite, Texture } from 'pixi.js';
import type { EffectManifest } from '../../core/registry';

export interface DisplacementParams {
  scaleX: number;
  scaleY: number;
}

// Генерируем текстуру с волнистым узором для красивого искажения,
// используем типизированный массив (буфер), так как canvas недоступен в Web Worker'ах
function createDisplacementTexture(): Texture {
  const width = 256;
  const height = 256;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Простой градиентный шум / волны на основе синусов
      const v = (Math.sin(x * 0.05) + Math.cos(y * 0.05)) * 0.5 + 0.5;
      const val = Math.floor(v * 255);

      const i = (y * width + x) * 4;
      data[i] = val; // R (влияет на X)
      data[i + 1] = val; // G (влияет на Y)
      data[i + 2] = val; // B
      data[i + 3] = 255; // A
    }
  }

  return Texture.from({
    resource: data,
    width,
    height,
  });
}

const displacementSprite = new Sprite(createDisplacementTexture());
// Для Pixi v8 настраиваем повторение текстуры
if (displacementSprite.texture.source) {
  displacementSprite.texture.source.addressMode = 'repeat';
}

export const displacementManifest: EffectManifest<DisplacementParams> = {
  type: 'displacement',
  name: 'Искажение',
  nameKey: 'fastcat.effects.video.displacement.name',
  description: 'Эффект смещения/волн',
  descriptionKey: 'fastcat.effects.video.displacement.description',
  icon: 'i-heroicons-arrows-pointing-out',
  defaultValues: {
    scaleX: 20,
    scaleY: 20,
  },
  controls: [
    {
      kind: 'slider',
      key: 'scaleX',
      label: 'Смещение X',
      labelKey: 'fastcat.effects.video.displacement.params.scaleX',
      min: 0,
      max: 200,
      step: 1,
    },
    {
      kind: 'slider',
      key: 'scaleY',
      label: 'Смещение Y',
      labelKey: 'fastcat.effects.video.displacement.params.scaleY',
      min: 0,
      max: 200,
      step: 1,
    },
  ],
  createFilter: () => new DisplacementFilter({ sprite: displacementSprite, scale: 20 }),
  updateFilter: (filter, values) => {
    const f = filter as DisplacementFilter;
    if (values.scaleX !== undefined) {
      f.scale.x = values.scaleX;
    }
    if (values.scaleY !== undefined) {
      f.scale.y = values.scaleY;
    }
  },
};
