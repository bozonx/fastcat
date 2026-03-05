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
  name: 'ЭЛТ Монитор',
  description: 'Эффект старого телевизора',
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
      label: 'Искажение',
      min: 0,
      max: 10,
      step: 0.1,
    },
    {
      kind: 'slider',
      key: 'lineWidth',
      label: 'Толщина линий',
      min: 0,
      max: 5,
      step: 0.1,
    },
    {
      kind: 'slider',
      key: 'lineContrast',
      label: 'Контраст линий',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'toggle',
      key: 'verticalLine',
      label: 'Вертикальные линии',
    },
    {
      kind: 'slider',
      key: 'noise',
      label: 'Шум',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'noiseSize',
      label: 'Размер шума',
      min: 1,
      max: 10,
      step: 0.1,
    },
    {
      kind: 'slider',
      key: 'vignetting',
      label: 'Виньетка',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'vignettingAlpha',
      label: 'Прозрачность виньетки',
      min: 0,
      max: 1,
      step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`,
    },
    {
      kind: 'slider',
      key: 'vignettingBlur',
      label: 'Размытие виньетки',
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
