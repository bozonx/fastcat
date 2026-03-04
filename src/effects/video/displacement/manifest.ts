import { DisplacementFilter, Sprite, Texture } from 'pixi.js';
import type { EffectManifest } from '../../core/registry';

export interface DisplacementParams {
  scaleX: number;
  scaleY: number;
}

// Создаем простую текстуру для смещения (в реальном приложении лучше использовать загруженную текстуру шума)
const displacementSprite = new Sprite(Texture.WHITE);
displacementSprite.texture.baseTexture.wrapMode = 'repeat';

export const displacementManifest: EffectManifest<DisplacementParams> = {
  type: 'displacement',
  name: 'Искажение',
  description: 'Эффект смещения/волн',
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
      min: 0,
      max: 100,
      step: 1,
    },
    {
      kind: 'slider',
      key: 'scaleY',
      label: 'Смещение Y',
      min: 0,
      max: 100,
      step: 1,
    },
  ],
  createFilter: () => new DisplacementFilter(displacementSprite, 20),
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
