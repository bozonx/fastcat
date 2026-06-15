import type { EffectParamRange, VideoEffectManifest } from './core/registry';
import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';

interface SliderFormat {
  (value: number): string;
}

// Per-parameter ranges. Three tiers, by design:
//   - uiMin/uiMax     — the comfortable manual slider range. Picked so the
//                       *useful* part of the effect is easy to dial in; not the
//                       absolute maximum the effect can do.
//   - animationMin/Max — the range an animation keyframe may reach. Wider than
//                       the slider so animations can push effects well past
//                       manual limits (e.g. a heavy blur easing down to none),
//                       but still bounded.
//   - renderMin/renderMax — the hard clamp applied before the value reaches the
//                       GPU. Mirrors the Rust `MAX_*` ceilings exactly and is
//                       the final safety net (`animationMax <= renderMax`).
// All spatial maxima are expressed in px @1080p; the backends scale them by the
// real frame height, so the visual amount is resolution-independent.
export const VIDEO_EFFECT_PARAM_RANGES = {
  colorMultiplier: {
    uiMin: 0,
    uiMax: 2,
    animationMin: 0,
    animationMax: 4,
    renderMin: 0,
    renderMax: 4,
  },
  blurRadius: {
    uiMin: 0,
    uiMax: 100,
    animationMin: 0,
    animationMax: 512,
    renderMin: 0,
    renderMax: 1024,
  },
  bloomRadius: {
    uiMin: 0,
    uiMax: 32,
    animationMin: 0,
    animationMax: 256,
    renderMin: 0,
    renderMax: 512,
  },
  bloomStrength: {
    uiMin: 0,
    uiMax: 2,
    animationMin: 0,
    animationMax: 4,
    renderMin: 0,
    renderMax: 4,
  },
  unit: { uiMin: 0, uiMax: 1, animationMin: 0, animationMax: 1, renderMin: 0, renderMax: 1 },
  // Sharpen amount: bidirectional. 0 is neutral (identity); positive sharpens
  // (unsharp mask), negative softens (the same kernel run with a negative
  // weight). −1..+1 is the comfortable manual range; animation can overshoot
  // for stylized pulses, hard-capped well below instability.
  sharpenAmount: {
    uiMin: -1,
    uiMax: 1,
    animationMin: -3,
    animationMax: 3,
    renderMin: -4,
    renderMax: 4,
  },
  pixelSize: {
    uiMin: 1,
    uiMax: 64,
    animationMin: 1,
    animationMax: 256,
    renderMin: 1,
    renderMax: 256,
  },
  chromaticAmount: {
    uiMin: 0,
    uiMax: 40,
    animationMin: 0,
    animationMax: 160,
    renderMin: 0,
    renderMax: 256,
  },
  hueDegrees: {
    uiMin: -180,
    uiMax: 180,
    animationMin: -1080,
    animationMax: 1080,
    renderMin: -1080,
    renderMax: 1080,
  },
  gamma: {
    // uiMin 0.1 is the comfortable manual floor; the render/animation floor
    // stays at the shader's hard 0.01 guard so keyframes can still go darker.
    uiMin: 0.1,
    uiMax: 8,
    animationMin: 0.01,
    animationMax: 16,
    renderMin: 0.01,
    renderMax: 16,
  },
} satisfies Record<string, EffectParamRange>;

const UINT32_MAX = 4_294_967_295;

const percentFromOne: SliderFormat = (value) => `${Math.round((value - 1) * 100)}%`;
const percent: SliderFormat = (value) => `${Math.round(value * 100)}%`;
const pixels: SliderFormat = (value) => `${value}px`;
const degrees: SliderFormat = (value) => `${value}deg`;
const decimal: SliderFormat = (value) => value.toFixed(2);

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampRange(value: number, range: Pick<EffectParamRange, 'renderMin' | 'renderMax'>) {
  return clamp(value, range.renderMin, range.renderMax);
}

function finiteNumberFromKeys(
  values: Record<string, unknown>,
  keys: string[],
  fallback: number,
): number {
  for (const key of keys) {
    const value = values[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return fallback;
}

// The catalog is intentionally loose about the per-variant shape: each manifest
// is responsible for emitting a spec whose fields match the corresponding Rust
// `EffectSpec` variant (mirrored as `VideoEffectSpec`). The cast keeps the
// public `toEffectSpecs` contract strongly typed for consumers.
function spec(type: VideoEffectSpec['type'], params: Record<string, unknown>): VideoEffectSpec {
  return { type, ...params } as VideoEffectSpec;
}

/**
 * Canonical video-effect catalog shared by both backends. The math lives in the
 * shared `shared/effects/effect.wgsl` compute shader; these manifests only
 * describe UI controls, defaults, and how UI values map to `VideoEffectSpec`.
 */
export const videoEffectManifests: VideoEffectManifest[] = [
  {
    type: 'color-adjustment',
    name: 'Color Correction',
    nameKey: 'fastcat.effects.video.color-adjustment.name',
    description: 'Adjust brightness, contrast, and saturation',
    descriptionKey: 'fastcat.effects.video.color-adjustment.description',
    icon: 'i-heroicons-swatch',
    target: 'video',
    renderer: 'wgsl-compute',
    defaultValues: {
      brightness: 1,
      contrast: 1,
      saturation: 1,
      hue: 0,
    },
    paramRanges: {
      brightness: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
      contrast: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
      saturation: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
      hue: VIDEO_EFFECT_PARAM_RANGES.hueDegrees,
    },
    controls: [
      {
        kind: 'slider',
        key: 'brightness',
        labelKey: 'fastcat.effects.video.color-adjustment.params.brightness',
        min: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMax,
        step: 0.05,
        format: percentFromOne,
      },
      {
        kind: 'slider',
        key: 'contrast',
        labelKey: 'fastcat.effects.video.color-adjustment.params.contrast',
        min: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMax,
        step: 0.05,
        format: percentFromOne,
      },
      {
        kind: 'slider',
        key: 'saturation',
        labelKey: 'fastcat.effects.video.color-adjustment.params.saturation',
        min: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMax,
        step: 0.05,
        format: percentFromOne,
      },
      {
        kind: 'slider',
        key: 'hue',
        labelKey: 'fastcat.effects.video.color-adjustment.params.hue',
        min: VIDEO_EFFECT_PARAM_RANGES.hueDegrees.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.hueDegrees.uiMax,
        step: 1,
        format: degrees,
      },
    ],
    toEffectSpecs: (values) => {
      const specs = [
        spec('brightness', {
          value: clampRange(
            finiteNumber(values.brightness, 1),
            VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
          ),
        }),
        spec('contrast', {
          value: clampRange(
            finiteNumber(values.contrast, 1),
            VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
          ),
        }),
        spec('saturation', {
          value: clampRange(
            finiteNumber(values.saturation, 1),
            VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
          ),
        }),
      ];

      const hueVal = finiteNumber(values.hue, 0);
      if (hueVal !== 0) {
        specs.push(
          spec('hue', {
            degrees: clampRange(hueVal, VIDEO_EFFECT_PARAM_RANGES.hueDegrees),
          }),
        );
      }

      return specs;
    },
  },
  {
    type: 'blur',
    name: 'Blur',
    nameKey: 'fastcat.effects.video.blur.name',
    description: 'Gaussian blur',
    descriptionKey: 'fastcat.effects.video.blur.description',
    icon: 'i-heroicons-sparkles',
    target: 'video',
    renderer: 'wgsl-compute',
    defaultValues: {
      blurType: 'gaussian',
      strength: 8,
      // Off by default: safe for opaque video (clamps to the frame edges, no
      // darkening). Turn on for PNGs / cutouts so the blur bleeds past the
      // rectangle into transparency.
      blurPastEdges: false,
    },
    paramRanges: {
      strength: VIDEO_EFFECT_PARAM_RANGES.blurRadius,
    },
    controls: [
      {
        kind: 'select',
        key: 'blurType',
        labelKey: 'fastcat.effects.video.blur.params.blurType',
        options: [
          { value: 'gaussian', labelKey: 'fastcat.effects.video.blur.options.gaussian' },
          { value: 'box', labelKey: 'fastcat.effects.video.blur.options.box' },
          { value: 'radial', labelKey: 'fastcat.effects.video.blur.options.radial' },
        ],
      },
      {
        kind: 'slider',
        key: 'strength',
        labelKey: 'fastcat.effects.video.blur.params.strength',
        min: VIDEO_EFFECT_PARAM_RANGES.blurRadius.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.blurRadius.uiMax,
        step: 1,
        format: pixels,
      },
      {
        kind: 'toggle',
        key: 'blurPastEdges',
        labelKey: 'fastcat.effects.video.blur.params.blurPastEdges',
      },
    ],
    toEffectSpecs: (values) => [
      spec('gaussian-blur', {
        radius: clampRange(
          finiteNumberFromKeys(values, ['strength', 'radius'], 8),
          VIDEO_EFFECT_PARAM_RANGES.blurRadius,
        ),
        bleed: values.blurPastEdges === true,
        blur_type: values.blurType || 'gaussian',
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
    renderer: 'wgsl-compute',
    defaultValues: {
      threshold: 0.75,
      strength: 0.6,
      radius: 12,
    },
    paramRanges: {
      threshold: VIDEO_EFFECT_PARAM_RANGES.unit,
      strength: VIDEO_EFFECT_PARAM_RANGES.bloomStrength,
      radius: VIDEO_EFFECT_PARAM_RANGES.bloomRadius,
    },
    controls: [
      {
        kind: 'slider',
        key: 'threshold',
        labelKey: 'fastcat.effects.video.bloom.params.threshold',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'strength',
        labelKey: 'fastcat.effects.video.bloom.params.strength',
        min: VIDEO_EFFECT_PARAM_RANGES.bloomStrength.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.bloomStrength.uiMax,
        step: 0.05,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'radius',
        labelKey: 'fastcat.effects.video.bloom.params.radius',
        min: VIDEO_EFFECT_PARAM_RANGES.bloomRadius.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.bloomRadius.uiMax,
        step: 1,
        format: pixels,
      },
    ],
    toEffectSpecs: (values) => [
      spec('bloom', {
        threshold: clampRange(finiteNumber(values.threshold, 0.75), VIDEO_EFFECT_PARAM_RANGES.unit),
        strength: clampRange(
          finiteNumber(values.strength, 0.6),
          VIDEO_EFFECT_PARAM_RANGES.bloomStrength,
        ),
        radius: clampRange(finiteNumber(values.radius, 12), VIDEO_EFFECT_PARAM_RANGES.bloomRadius),
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
    renderer: 'wgsl-compute',
    defaultValues: {
      amount: 0,
    },
    paramRanges: {
      amount: VIDEO_EFFECT_PARAM_RANGES.sharpenAmount,
    },
    controls: [
      {
        kind: 'slider',
        key: 'amount',
        labelKey: 'fastcat.effects.video.tauri.params.amount',
        min: VIDEO_EFFECT_PARAM_RANGES.sharpenAmount.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.sharpenAmount.uiMax,
        step: 0.01,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('sharpen', {
        amount: clampRange(finiteNumber(values.amount, 0), VIDEO_EFFECT_PARAM_RANGES.sharpenAmount),
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
    renderer: 'wgsl-compute',
    defaultValues: {
      size: 8,
    },
    paramRanges: {
      size: VIDEO_EFFECT_PARAM_RANGES.pixelSize,
    },
    controls: [
      {
        kind: 'slider',
        key: 'size',
        labelKey: 'fastcat.effects.video.tauri.pixelate.params.size',
        min: VIDEO_EFFECT_PARAM_RANGES.pixelSize.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.pixelSize.uiMax,
        step: 1,
        format: pixels,
      },
    ],
    toEffectSpecs: (values) => [
      spec('pixelate', {
        size: clampRange(finiteNumber(values.size, 8), VIDEO_EFFECT_PARAM_RANGES.pixelSize),
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
    renderer: 'wgsl-compute',
    defaultValues: {
      strength: 0.35,
      radius: 0.75,
      softness: 0.35,
    },
    paramRanges: {
      strength: VIDEO_EFFECT_PARAM_RANGES.unit,
      radius: VIDEO_EFFECT_PARAM_RANGES.unit,
      softness: VIDEO_EFFECT_PARAM_RANGES.unit,
    },
    controls: [
      {
        kind: 'slider',
        key: 'strength',
        labelKey: 'fastcat.effects.video.tauri.vignette.params.strength',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'radius',
        labelKey: 'fastcat.effects.video.tauri.vignette.params.radius',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'softness',
        labelKey: 'fastcat.effects.video.tauri.vignette.params.softness',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('vignette', {
        strength: clampRange(finiteNumber(values.strength, 0.35), VIDEO_EFFECT_PARAM_RANGES.unit),
        radius: clampRange(finiteNumber(values.radius, 0.75), VIDEO_EFFECT_PARAM_RANGES.unit),
        // Softness floor matches the shader's smoothstep guard (0 would be a
        // degenerate hard edge); the backend also clamps to 0.001.
        softness: clamp(
          finiteNumber(values.softness, 0.35),
          0.001,
          VIDEO_EFFECT_PARAM_RANGES.unit.renderMax,
        ),
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
    renderer: 'wgsl-compute',
    defaultValues: {
      noiseType: 'white',
      amount: 0.08,
      seed: 1,
    },
    paramRanges: {
      amount: VIDEO_EFFECT_PARAM_RANGES.unit,
      seed: {
        uiMin: 0,
        uiMax: 65535,
        animationMin: 0,
        animationMax: UINT32_MAX,
        renderMin: 0,
        renderMax: UINT32_MAX,
      },
    },
    controls: [
      {
        kind: 'select',
        key: 'noiseType',
        labelKey: 'fastcat.effects.video.noise.params.noiseType',
        options: [
          { value: 'white', labelKey: 'fastcat.effects.video.noise.options.white' },
          { value: 'perlin', labelKey: 'fastcat.effects.video.noise.options.perlin' },
          { value: 'simplex', labelKey: 'fastcat.effects.video.noise.options.simplex' },
        ],
      },
      {
        kind: 'slider',
        key: 'amount',
        labelKey: 'fastcat.effects.video.noise.params.noise',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
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
    toEffectSpecs: (values) => [
      spec('noise', {
        amount: clampRange(finiteNumber(values.amount, 0.08), VIDEO_EFFECT_PARAM_RANGES.unit),
        seed: clamp(Math.round(finiteNumber(values.seed, 1)), 0, UINT32_MAX),
        noise_type: values.noiseType || 'white',
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
    renderer: 'wgsl-compute',
    defaultValues: {
      amount: 4,
      angle: 0,
    },
    paramRanges: {
      amount: VIDEO_EFFECT_PARAM_RANGES.chromaticAmount,
      angle: VIDEO_EFFECT_PARAM_RANGES.hueDegrees,
    },
    controls: [
      {
        kind: 'slider',
        key: 'amount',
        labelKey: 'fastcat.effects.video.tauri.params.amount',
        min: VIDEO_EFFECT_PARAM_RANGES.chromaticAmount.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.chromaticAmount.uiMax,
        step: 0.5,
        format: pixels,
      },
      {
        kind: 'slider',
        key: 'angle',
        labelKey: 'fastcat.effects.video.tauri.params.angle',
        min: VIDEO_EFFECT_PARAM_RANGES.hueDegrees.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.hueDegrees.uiMax,
        step: 1,
        format: degrees,
      },
    ],
    toEffectSpecs: (values) => [
      spec('chromatic-aberration', {
        amount: clampRange(
          finiteNumber(values.amount, 4),
          VIDEO_EFFECT_PARAM_RANGES.chromaticAmount,
        ),
        angle_deg: clampRange(finiteNumber(values.angle, 0), VIDEO_EFFECT_PARAM_RANGES.hueDegrees),
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
    renderer: 'wgsl-compute',
    hidden: true,
    defaultValues: {
      degrees: 0,
    },
    paramRanges: {
      degrees: VIDEO_EFFECT_PARAM_RANGES.hueDegrees,
    },
    controls: [
      {
        kind: 'slider',
        key: 'degrees',
        labelKey: 'fastcat.effects.video.tauri.params.angle',
        min: VIDEO_EFFECT_PARAM_RANGES.hueDegrees.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.hueDegrees.uiMax,
        step: 1,
        format: degrees,
      },
    ],
    toEffectSpecs: (values) => [
      spec('hue', {
        degrees: clampRange(finiteNumber(values.degrees, 0), VIDEO_EFFECT_PARAM_RANGES.hueDegrees),
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
    renderer: 'wgsl-compute',
    defaultValues: {
      inBlack: 0,
      inWhite: 1,
      gamma: 1,
      outBlack: 0,
      outWhite: 1,
    },
    paramRanges: {
      inBlack: VIDEO_EFFECT_PARAM_RANGES.unit,
      inWhite: VIDEO_EFFECT_PARAM_RANGES.unit,
      gamma: VIDEO_EFFECT_PARAM_RANGES.gamma,
      outBlack: VIDEO_EFFECT_PARAM_RANGES.unit,
      outWhite: VIDEO_EFFECT_PARAM_RANGES.unit,
    },
    controls: [
      {
        kind: 'slider',
        key: 'inBlack',
        labelKey: 'fastcat.effects.video.tauri.levels.params.inBlack',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'inWhite',
        labelKey: 'fastcat.effects.video.tauri.levels.params.inWhite',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'gamma',
        labelKey: 'fastcat.effects.video.tauri.levels.params.gamma',
        min: VIDEO_EFFECT_PARAM_RANGES.gamma.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.gamma.uiMax,
        step: 0.05,
        format: decimal,
      },
      {
        kind: 'slider',
        key: 'outBlack',
        labelKey: 'fastcat.effects.video.tauri.levels.params.outBlack',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'outWhite',
        labelKey: 'fastcat.effects.video.tauri.levels.params.outWhite',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('levels', {
        in_black: clampRange(finiteNumber(values.inBlack, 0), VIDEO_EFFECT_PARAM_RANGES.unit),
        in_white: clamp(
          finiteNumber(values.inWhite, 1),
          0.001,
          VIDEO_EFFECT_PARAM_RANGES.unit.renderMax,
        ),
        gamma: clampRange(finiteNumber(values.gamma, 1), VIDEO_EFFECT_PARAM_RANGES.gamma),
        out_black: clampRange(finiteNumber(values.outBlack, 0), VIDEO_EFFECT_PARAM_RANGES.unit),
        out_white: clampRange(finiteNumber(values.outWhite, 1), VIDEO_EFFECT_PARAM_RANGES.unit),
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
    renderer: 'wgsl-compute',
    experimental: true,
    defaultValues: {
      keyColor: '#00ff00',
      threshold: 0.1,
      smoothness: 0.1,
    },
    paramRanges: {
      threshold: VIDEO_EFFECT_PARAM_RANGES.unit,
      smoothness: VIDEO_EFFECT_PARAM_RANGES.unit,
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
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'smoothness',
        labelKey: 'fastcat.effects.video.tauri.chromaKey.params.smoothness',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => {
      const colorHex = typeof values.keyColor === 'string' ? values.keyColor : '#00ff00';
      const clean = colorHex.replace('#', '');
      const r = parseInt(clean.substring(0, 2), 16) || 0;
      const g = parseInt(clean.substring(2, 4), 16) || 0;
      const b = parseInt(clean.substring(4, 6), 16) || 0;
      const a = clean.length >= 8 ? parseInt(clean.substring(6, 8), 16) : 255;
      return [
        spec('chroma-key', {
          key_rgba: [r, g, b, a],
          threshold: clampRange(
            finiteNumber(values.threshold, 0.1),
            VIDEO_EFFECT_PARAM_RANGES.unit,
          ),
          smoothness: clamp(
            finiteNumber(values.smoothness, 0.1),
            0.0001,
            VIDEO_EFFECT_PARAM_RANGES.unit.renderMax,
          ),
        }),
      ];
    },
  },
];

const videoManifestByType = new Map(
  videoEffectManifests.map((manifest) => [manifest.type, manifest]),
);

export function getVideoEffectManifestByType(type: string): VideoEffectManifest | undefined {
  return videoManifestByType.get(type);
}
