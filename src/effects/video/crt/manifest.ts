import { CRTFilter } from 'pixi-filters';
import type { EffectManifest } from '../../core/registry';

export interface CRTParams {
  curvature: number;
  lineWidth: number;
  lineContrast: number;
  verticalLine: boolean;
  noise: number;
  noiseSize: number;
  vignetting: number;
  vignettingAlpha: number;
  vignettingBlur: number;
}

export const crtManifest: EffectManifest<CRTParams> = {
  type: 'crt',
  name: 'CRT Monitor',
  nameKey: 'fastcat.effects.video.crt.name',
  description: 'Old TV effect',
  descriptionKey: 'fastcat.effects.video.crt.description',
  icon: 'i-heroicons-computer-desktop',
  defaultValues: {
    curvature: 1,
    lineWidth: 1,
    lineContrast: 0.25,
    verticalLine: false,
    noise: 0.3,
    noiseSize: 1,
    vignetting: 0.3,
    vignettingAlpha: 1,
    vignettingBlur: 0.3,
  },
  controls: [
    {
      kind: 'slider',
      key: 'curvature',
      label: 'Distortion',
      labelKey: 'fastcat.effects.video.crt.params.curvature',
      min: 0,
      max: 10,
      step: 0.1,
    },
    {
      kind: 'slider',
      key: 'lineWidth',
      label: 'Line Width',
      labelKey: 'fastcat.effects.video.crt.params.lineWidth',
      min: 0,
      max: 5,
      step: 0.1,
    },
    {
      kind: 'slider',
      key: 'lineContrast',
      label: 'Line Contrast',
      labelKey: 'fastcat.effects.video.crt.params.lineContrast',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'toggle',
      key: 'verticalLine',
      label: 'Vertical Lines',
      labelKey: 'fastcat.effects.video.crt.params.verticalLine',
    },
    {
      kind: 'slider',
      key: 'noise',
      label: 'Noise',
      labelKey: 'fastcat.effects.video.crt.params.noise',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'noiseSize',
      label: 'Noise Size',
      labelKey: 'fastcat.effects.video.crt.params.noiseSize',
      min: 1,
      max: 10,
      step: 0.1,
    },
    {
      kind: 'slider',
      key: 'vignetting',
      label: 'Vignette',
      labelKey: 'fastcat.effects.video.crt.params.vignetting',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'vignettingAlpha',
      label: 'Vignette Opacity',
      labelKey: 'fastcat.effects.video.crt.params.vignettingAlpha',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'vignettingBlur',
      label: 'Vignette Blur',
      labelKey: 'fastcat.effects.video.crt.params.vignettingBlur',
      min: 0,
      max: 1,
      step: 0.01,
    },
  ],
  createFilter: () =>
    new CRTFilter({
      curvature: 1,
      lineWidth: 1,
      lineContrast: 0.25,
      verticalLine: false,
      noise: 0.3,
      noiseSize: 1,
      vignetting: 0.3,
      vignettingAlpha: 1,
      vignettingBlur: 0.3,
    }),
  updateFilter: (filter, values) => {
    const f = filter as CRTFilter;
    if (values.curvature !== undefined) f.curvature = values.curvature;
    if (values.lineWidth !== undefined) f.lineWidth = values.lineWidth;
    if (values.lineContrast !== undefined) f.lineContrast = values.lineContrast;
    if (values.verticalLine !== undefined) f.verticalLine = values.verticalLine;
    if (values.noise !== undefined) f.noise = values.noise;
    if (values.noiseSize !== undefined) f.noiseSize = values.noiseSize;
    if (values.vignetting !== undefined) f.vignetting = values.vignetting;
    if (values.vignettingAlpha !== undefined) f.vignettingAlpha = values.vignettingAlpha;
    if (values.vignettingBlur !== undefined) f.vignettingBlur = values.vignettingBlur;
  },
};
