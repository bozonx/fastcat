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
        max: 80,
        step: 1,
        format: pixels,
      },
    ],
    toTauriSpecs: (values) => [
      spec('gaussian-blur', {
        radius: clamp(finiteNumber(values.strength, 8), 0, 80),
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
        max: 80,
        step: 1,
        format: pixels,
      },
    ],
    toTauriSpecs: (values) => [
      spec('bloom', {
        threshold: clamp(finiteNumber(values.threshold, 0.75), 0, 1),
        strength: clamp(finiteNumber(values.strength, 0.6), 0, 2),
        radius: clamp(finiteNumber(values.radius, 12), 0, 80),
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
];

const tauriVideoManifestByType = new Map(
  tauriVideoEffectManifests.map((manifest) => [manifest.type, manifest]),
);

export function getTauriVideoEffectManifest(type: string): VideoEffectManifest | undefined {
  return tauriVideoManifestByType.get(type);
}
