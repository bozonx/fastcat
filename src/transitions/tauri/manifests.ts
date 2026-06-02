import {
  applyTransitionCurve,
  type TransitionManifest,
  type TauriTransitionSpec,
} from '../core/registry';

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const transparent = () => 1;

export const tauriTransitionManifests: TransitionManifest[] = [
  {
    type: 'dissolve',
    name: 'Dissolve',
    nameKey: 'fastcat.transitions.dissolve.name',
    icon: 'i-heroicons-arrows-right-left',
    defaultDurationUs: 500_000,
    defaultParams: {},
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: () => ({ type: 'crossfade' }),
    computeOutOpacity: () => 1,
    computeInOpacity: () => 1,
  },
  {
    type: 'wipe',
    name: 'Wipe',
    nameKey: 'fastcat.transitions.wipe.name',
    icon: 'i-heroicons-arrow-long-right',
    defaultDurationUs: 700_000,
    defaultParams: {
      angle: 0,
      softness: 0.08,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    paramFields: [
      {
        kind: 'slider',
        key: 'angle',
        labelKey: 'fastcat.effects.video.dot.params.angle',
        min: -180,
        max: 180,
        step: 1,
      },
      {
        kind: 'slider',
        key: 'softness',
        labelKey: 'fastcat.transitions.wipe.params.softness',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTauriSpec: (params) => ({
      type: 'wipe',
      angle_deg: clamp(finiteNumber(params.angle, 0), -180, 180),
      softness: clamp(finiteNumber(params.softness, 0.08), 0, 1),
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'slide',
    name: 'Slide',
    nameKey: 'fastcat.transitions.slide.name',
    icon: 'i-heroicons-arrows-pointing-out',
    defaultDurationUs: 700_000,
    defaultParams: {
      direction: 'left',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    paramFields: [
      {
        kind: 'select',
        key: 'direction',
        labelKey: 'fastcat.transitions.slide.params.direction',
        options: [
          { labelKey: 'fastcat.transitions.slide.options.left', value: 'left' },
          { labelKey: 'fastcat.transitions.slide.options.right', value: 'right' },
          { labelKey: 'fastcat.transitions.slide.options.up', value: 'up' },
          { labelKey: 'fastcat.transitions.slide.options.down', value: 'down' },
        ],
      },
    ],
    toTauriSpec: (params): TauriTransitionSpec => {
      const raw = params.direction;
      const direction =
        raw === 'right' || raw === 'up' || raw === 'down' || raw === 'left' ? raw : 'left';
      return { type: 'slide', direction };
    },
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
  {
    type: 'fade-to-black',
    name: 'Fade to Black',
    nameKey: 'fastcat.transitions.fade-to-black.name',
    icon: 'i-heroicons-moon',
    defaultDurationUs: 700_000,
    defaultParams: {
      color: '#000000',
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    toTauriSpec: (params) => ({
      type: 'fade-through-color',
      color: typeof params.color === 'string' ? params.color : '#000000',
    }),
    computeOutOpacity: (progress, _params, curve) => {
      const t = applyTransitionCurve(progress, curve);
      return t < 0.5 ? 1 - t * 2 : 0;
    },
    computeInOpacity: (progress, _params, curve) => {
      const t = applyTransitionCurve(progress, curve);
      return t < 0.5 ? 0 : (t - 0.5) * 2;
    },
  },
  {
    type: 'circle',
    name: 'Circle Reveal',
    nameKey: 'fastcat.transitions.circle.name',
    icon: 'i-heroicons-eye',
    defaultDurationUs: 700_000,
    defaultParams: {
      centerX: 0.5,
      centerY: 0.5,
      softness: 0.08,
    },
    renderMode: 'shader',
    renderer: 'wgpu',
    paramFields: [
      {
        kind: 'slider',
        key: 'centerX',
        labelKey: 'fastcat.effects.video.bulgePinch.params.centerX',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'slider',
        key: 'centerY',
        labelKey: 'fastcat.effects.video.bulgePinch.params.centerY',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'slider',
        key: 'softness',
        labelKey: 'fastcat.transitions.wipe.params.softness',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
    toTauriSpec: (params) => ({
      type: 'circle-reveal',
      center: [
        clamp(finiteNumber(params.centerX, 0.5), 0, 1),
        clamp(finiteNumber(params.centerY, 0.5), 0, 1),
      ],
      softness: clamp(finiteNumber(params.softness, 0.08), 0, 1),
    }),
    computeOutOpacity: transparent,
    computeInOpacity: transparent,
  },
];

const tauriTransitionManifestByType = new Map(
  tauriTransitionManifests.map((manifest) => [manifest.type, manifest]),
);

export function getTauriTransitionManifest(type: string): TransitionManifest | undefined {
  return tauriTransitionManifestByType.get(type);
}
