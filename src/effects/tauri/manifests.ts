import type { TauriEffectSpec, VideoEffectManifest } from '../core/registry';

interface SliderFormat {
  (value: number): string;
}

const percentFromOne: SliderFormat = (value) => `${Math.round((value - 1) * 100)}%`;
const percent: SliderFormat = (value) => `${Math.round(value * 100)}%`;
const pixels: SliderFormat = (value) => `${value}px`;
const degrees: SliderFormat = (value) => `${value}deg`;

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function spec(type: string, params: Record<string, unknown>): TauriEffectSpec {
  return { type, ...params };
}

export const tauriVideoEffectManifests: VideoEffectManifest[] = [
  {
    type: 'color-adjustment',
    name: 'Color Correction',
    nameKey: 'fastcat.effects.video.color-adjustment.name',
    description: 'Adjust brightness, contrast, and saturation',
    descriptionKey: 'fastcat.effects.video.color-adjustment.description',
    icon: 'i-heroicons-swatch',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      brightness: 1,
      contrast: 1,
      saturation: 1,
    },
    controls: [
      {
        kind: 'slider',
        key: 'brightness',
        labelKey: 'fastcat.effects.video.color-adjustment.params.brightness',
        min: 0,
        max: 2,
        step: 0.05,
        format: percentFromOne,
      },
      {
        kind: 'slider',
        key: 'contrast',
        labelKey: 'fastcat.effects.video.color-adjustment.params.contrast',
        min: 0,
        max: 2,
        step: 0.05,
        format: percentFromOne,
      },
      {
        kind: 'slider',
        key: 'saturation',
        labelKey: 'fastcat.effects.video.color-adjustment.params.saturation',
        min: 0,
        max: 2,
        step: 0.05,
        format: percentFromOne,
      },
    ],
    toTauriSpecs: (values) => [
      spec('brightness', {
        value: clamp(finiteNumber(values.brightness, 1), 0, 2),
      }),
      spec('contrast', {
        value: clamp(finiteNumber(values.contrast, 1), 0, 2),
      }),
      spec('saturation', {
        value: clamp(finiteNumber(values.saturation, 1), 0, 2),
      }),
    ],
  },
  {
    type: 'blur',
    name: 'Blur',
    nameKey: 'fastcat.effects.video.blur.name',
    description: 'Gaussian blur',
    descriptionKey: 'fastcat.effects.video.blur.description',
    icon: 'i-heroicons-sparkles',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      strength: 8,
    },
    controls: [
      {
        kind: 'slider',
        key: 'strength',
        labelKey: 'fastcat.effects.video.blur.params.strength',
        min: 0,
        max: 64,
        step: 1,
        format: pixels,
      },
    ],
    toTauriSpecs: (values) => [
      spec('gaussian-blur', {
        radius: clamp(finiteNumber(values.strength, 8), 0, 64),
      }),
    ],
  },
  {
    type: 'bloom',
    name: 'Bloom',
    nameKey: 'fastcat.effects.video.bloom.name',
    description: 'Soft glow for bright regions',
    descriptionKey: 'fastcat.effects.video.bloom.description',
    icon: 'i-heroicons-sun',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      threshold: 0.75,
      strength: 0.6,
      radius: 12,
    },
    controls: [
      {
        kind: 'slider',
        key: 'threshold',
        labelKey: 'fastcat.effects.video.advancedBloom.params.threshold',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'strength',
        labelKey: 'fastcat.effects.video.bloom.params.strength',
        min: 0,
        max: 2,
        step: 0.05,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'radius',
        labelKey: 'fastcat.effects.video.blur.params.strength',
        min: 0,
        max: 16,
        step: 1,
        format: pixels,
      },
    ],
    toTauriSpecs: (values) => [
      spec('bloom', {
        threshold: clamp(finiteNumber(values.threshold, 0.75), 0, 1),
        strength: clamp(finiteNumber(values.strength, 0.6), 0, 2),
        radius: clamp(finiteNumber(values.radius, 12), 0, 16),
      }),
    ],
  },
  {
    type: 'sharpen',
    name: 'Sharpen',
    nameKey: 'fastcat.effects.video.tauri.sharpen.name',
    description: 'Increase edge contrast',
    descriptionKey: 'fastcat.effects.video.tauri.sharpen.description',
    icon: 'i-heroicons-bolt',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      amount: 0.35,
    },
    controls: [
      {
        kind: 'slider',
        key: 'amount',
        labelKey: 'fastcat.effects.video.tauri.params.amount',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
    ],
    toTauriSpecs: (values) => [
      spec('sharpen', {
        amount: clamp(finiteNumber(values.amount, 0.35), 0, 1),
      }),
    ],
  },
  {
    type: 'pixelate',
    name: 'Pixelate',
    nameKey: 'fastcat.effects.video.tauri.pixelate.name',
    description: 'Blocky pixel sampling',
    descriptionKey: 'fastcat.effects.video.tauri.pixelate.description',
    icon: 'i-heroicons-squares-2x2',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      size: 8,
    },
    controls: [
      {
        kind: 'slider',
        key: 'size',
        labelKey: 'fastcat.effects.video.ascii.params.size',
        min: 1,
        max: 64,
        step: 1,
        format: pixels,
      },
    ],
    toTauriSpecs: (values) => [
      spec('pixelate', {
        size: clamp(finiteNumber(values.size, 8), 1, 64),
      }),
    ],
  },
  {
    type: 'vignette',
    name: 'Vignette',
    nameKey: 'fastcat.effects.video.tauri.vignette.name',
    description: 'Darken image edges',
    descriptionKey: 'fastcat.effects.video.tauri.vignette.description',
    icon: 'i-heroicons-eye',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      strength: 0.35,
      radius: 0.75,
      softness: 0.35,
    },
    controls: [
      {
        kind: 'slider',
        key: 'strength',
        labelKey: 'fastcat.effects.video.bloom.params.strength',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'radius',
        labelKey: 'fastcat.transitions.circle.params.radius',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'softness',
        labelKey: 'fastcat.transitions.wipe.params.softness',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
    ],
    toTauriSpecs: (values) => [
      spec('vignette', {
        strength: clamp(finiteNumber(values.strength, 0.35), 0, 1),
        radius: clamp(finiteNumber(values.radius, 0.75), 0, 1),
        softness: clamp(finiteNumber(values.softness, 0.35), 0, 1),
      }),
    ],
  },
  {
    type: 'noise',
    name: 'Noise',
    nameKey: 'fastcat.effects.video.noise.name',
    description: 'Film grain and procedural noise',
    descriptionKey: 'fastcat.effects.video.noise.description',
    icon: 'i-heroicons-sparkles',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      amount: 0.08,
      seed: 1,
    },
    controls: [
      {
        kind: 'slider',
        key: 'amount',
        labelKey: 'fastcat.effects.video.noise.params.noise',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'number',
        key: 'seed',
        labelKey: 'fastcat.effects.video.noise.params.seed',
        min: 0,
        max: 65535,
        step: 1,
      },
    ],
    toTauriSpecs: (values) => [
      spec('noise', {
        amount: clamp(finiteNumber(values.amount, 0.08), 0, 1),
        seed: Math.max(0, Math.round(finiteNumber(values.seed, 1))),
      }),
    ],
  },
  {
    type: 'chromatic-aberration',
    name: 'Chromatic Aberration',
    nameKey: 'fastcat.effects.video.tauri.chromaticAberration.name',
    description: 'Offset color channels',
    descriptionKey: 'fastcat.effects.video.tauri.chromaticAberration.description',
    icon: 'i-heroicons-adjustments-horizontal',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      amount: 4,
      angle: 0,
    },
    controls: [
      {
        kind: 'slider',
        key: 'amount',
        labelKey: 'fastcat.effects.video.tauri.params.amount',
        min: 0,
        max: 40,
        step: 0.5,
        format: pixels,
      },
      {
        kind: 'slider',
        key: 'angle',
        labelKey: 'fastcat.effects.video.dot.params.angle',
        min: -180,
        max: 180,
        step: 1,
        format: degrees,
      },
    ],
    toTauriSpecs: (values) => [
      spec('chromatic-aberration', {
        amount: clamp(finiteNumber(values.amount, 4), 0, 40),
        angle_deg: clamp(finiteNumber(values.angle, 0), -180, 180),
      }),
    ],
  },
  {
    type: 'hue',
    name: 'Hue Rotation',
    nameKey: 'fastcat.effects.video.tauri.hue.name',
    description: 'Rotate color hues',
    descriptionKey: 'fastcat.effects.video.tauri.hue.description',
    icon: 'i-heroicons-arrow-path',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      degrees: 0,
    },
    controls: [
      {
        kind: 'slider',
        key: 'degrees',
        labelKey: 'fastcat.effects.video.dot.params.angle',
        min: -180,
        max: 180,
        step: 1,
        format: degrees,
      },
    ],
    toTauriSpecs: (values) => [
      spec('hue', {
        degrees: clamp(finiteNumber(values.degrees, 0), -180, 180),
      }),
    ],
  },
  {
    type: 'levels',
    name: 'Levels',
    nameKey: 'fastcat.effects.video.tauri.levels.name',
    description: 'Adjust input and output color levels',
    descriptionKey: 'fastcat.effects.video.tauri.levels.description',
    icon: 'i-heroicons-adjustments-vertical',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      inBlack: 0,
      inWhite: 1,
      gamma: 1,
      outBlack: 0,
      outWhite: 1,
    },
    controls: [
      {
        kind: 'slider',
        key: 'inBlack',
        labelKey: 'fastcat.effects.video.tauri.levels.params.inBlack',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'inWhite',
        labelKey: 'fastcat.effects.video.tauri.levels.params.inWhite',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'gamma',
        labelKey: 'fastcat.effects.video.tauri.levels.params.gamma',
        min: 0.01,
        max: 8.0,
        step: 0.05,
      },
      {
        kind: 'slider',
        key: 'outBlack',
        labelKey: 'fastcat.effects.video.tauri.levels.params.outBlack',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'outWhite',
        labelKey: 'fastcat.effects.video.tauri.levels.params.outWhite',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
    ],
    toTauriSpecs: (values) => [
      spec('levels', {
        in_black: clamp(finiteNumber(values.inBlack, 0), 0, 1),
        in_white: clamp(finiteNumber(values.inWhite, 1), 0.001, 1),
        gamma: clamp(finiteNumber(values.gamma, 1), 0.01, 8.0),
        out_black: clamp(finiteNumber(values.outBlack, 0), 0, 1),
        out_white: clamp(finiteNumber(values.outWhite, 1), 0, 1),
      }),
    ],
  },
  {
    type: 'chroma-key',
    name: 'Chroma Key',
    nameKey: 'fastcat.effects.video.tauri.chromaKey.name',
    description: 'Key out a specific background color',
    descriptionKey: 'fastcat.effects.video.tauri.chromaKey.description',
    icon: 'i-heroicons-sparkles',
    target: 'video',
    renderer: 'wgpu',
    defaultValues: {
      keyColor: '#00ff00',
      threshold: 0.1,
      smoothness: 0.1,
    },
    controls: [
      {
        kind: 'color',
        key: 'keyColor',
        labelKey: 'fastcat.effects.video.tauri.chromaKey.params.keyColor',
      },
      {
        kind: 'slider',
        key: 'threshold',
        labelKey: 'fastcat.effects.video.tauri.chromaKey.params.threshold',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'smoothness',
        labelKey: 'fastcat.effects.video.tauri.chromaKey.params.smoothness',
        min: 0,
        max: 1,
        step: 0.01,
        format: percent,
      },
    ],
    toTauriSpecs: (values) => {
      const colorHex = typeof values.keyColor === 'string' ? values.keyColor : '#00ff00';
      const clean = colorHex.replace('#', '');
      const r = parseInt(clean.substring(0, 2), 16) || 0;
      const g = parseInt(clean.substring(2, 4), 16) || 0;
      const b = parseInt(clean.substring(4, 6), 16) || 0;
      const a = clean.length >= 8 ? parseInt(clean.substring(6, 8), 16) : 255;
      return [
        spec('chroma-key', {
          key_rgba: [r, g, b, a],
          threshold: clamp(finiteNumber(values.threshold, 0.1), 0, 1),
          smoothness: clamp(finiteNumber(values.smoothness, 0.1), 0.0001, 1),
        }),
      ];
    },
  },
];

const tauriVideoManifestByType = new Map(
  tauriVideoEffectManifests.map((manifest) => [manifest.type, manifest]),
);

export function getTauriVideoEffectManifest(type: string): VideoEffectManifest | undefined {
  return tauriVideoManifestByType.get(type);
}
