import { BulgePinchFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface BulgePinchParams {
  centerX: number;
  centerY: number;
  radius: number;
  strength: number;
}

export const bulgePinchManifest: EffectManifest<BulgePinchParams> = {
  type: 'bulgePinch',
  name: 'Bulge/Pinch',
  nameKey: 'fastcat.effects.video.bulgePinch.name',
  description: 'Bulge or pinch distortion (fisheye)',
  descriptionKey: 'fastcat.effects.video.bulgePinch.description',
  icon: 'i-heroicons-arrows-pointing-out',
  defaultValues: {
    centerX: 0.5,
    centerY: 0.5,
    radius: 100,
    strength: 1,
  },
  controls: [
    {
      kind: 'slider',
      key: 'centerX',
      label: 'Center X',
      labelKey: 'fastcat.effects.video.bulgePinch.params.centerX',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'centerY',
      label: 'Center Y',
      labelKey: 'fastcat.effects.video.bulgePinch.params.centerY',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'radius',
      label: 'Radius',
      labelKey: 'fastcat.effects.video.bulgePinch.params.radius',
      min: 0,
      max: 500,
      step: 1,
      format: (v) => `${v}px`,
    },
    {
      kind: 'slider',
      key: 'strength',
      label: 'Strength',
      labelKey: 'fastcat.effects.video.bulgePinch.params.strength',
      min: -1,
      max: 1,
      step: 0.05,
    },
  ],
  createFilter: () =>
    new BulgePinchFilter({
      center: [0.5, 0.5],
      radius: 100,
      strength: 1,
    }),
  updateFilter: (filter, values) => {
    const f = filter as BulgePinchFilter;
    if (values.centerX !== undefined && values.centerY !== undefined) {
      f.center = [values.centerX, values.centerY];
    }
    if (values.radius !== undefined) f.radius = values.radius;
    if (values.strength !== undefined) f.strength = values.strength;
  },
};
