import type { EffectParamRange, VideoEffectManifest } from './core/registry';
import type { VideoEffectSpec } from '~/types/generated/native-monitor/VideoEffectSpec';
import { normalizeHexColor } from '~/utils/color';
import { clamp, clampFinite } from '~/utils/math';

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
    // Raised from 100 so the slider can reach a genuinely strong blur — the old
    // cap left directional blur types (notably radial/zoom blur, which only
    // spreads along the radius and stays sharp at the centre) looking too soft
    // at the maximum. animationMax/renderMax stay well above it.
    uiMax: 200,
    animationMin: 0,
    animationMax: 512,
    renderMin: 0,
    renderMax: 1024,
  },
  bloomRadius: {
    uiMin: 0,
    // Raised from 32 so a genuinely *strong* blur is reachable from the slider
    // (the old cap forced large glows through animation-only). Matches the
    // comfortable blur range. animationMax == renderMax: no dead band above it.
    uiMax: 100,
    animationMin: 0,
    animationMax: 512,
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
  // Bloom soft-knee width: 0 is a hard threshold (crisp highlight cutoff), 1 is
  // a wide, gentle ramp that lets mid-bright pixels glow softly.
  bloomKnee: {
    uiMin: 0,
    uiMax: 1,
    animationMin: 0,
    animationMax: 1,
    renderMin: 0,
    renderMax: 1,
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
  intensity: {
    uiMin: 0,
    uiMax: 1,
    animationMin: 0,
    animationMax: 1,
    renderMin: 0,
    renderMax: 1,
  },
  // Blur-fill fore/background scale (ratio; 1 = 100%). Render ceiling mirrors
  // the Rust `MAX_BLUR_FILL_SCALE`.
  fillScale: {
    uiMin: 0.5,
    uiMax: 2,
    animationMin: 0.1,
    animationMax: 8,
    renderMin: 0.1,
    renderMax: 8,
  },
  // Blur-fill background saturation (1 = normal, 0 = grayscale, 2 = boosted).
  saturation: {
    uiMin: 0,
    uiMax: 2,
    animationMin: 0,
    animationMax: 2,
    renderMin: 0,
    renderMax: 2,
  },
  // Blur-fill foreground vertical offset as a fraction of frame height.
  offset: {
    uiMin: -0.5,
    uiMax: 0.5,
    animationMin: -0.5,
    animationMax: 0.5,
    renderMin: -0.5,
    renderMax: 0.5,
  },
} satisfies Record<string, EffectParamRange>;

const UINT32_MAX = 4_294_967_295;

const percentFromOne: SliderFormat = (value) => `${Math.round((value - 1) * 100)}%`;
const percent: SliderFormat = (value) => `${Math.round(value * 100)}%`;
const pixels: SliderFormat = (value) => `${value}px`;
const degrees: SliderFormat = (value) => `${value}deg`;
const decimal: SliderFormat = (value) => value.toFixed(2);

const COLOR_TONE_BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light'] as const;
const COLOR_TONE_RANGES = ['all', 'shadows', 'midtones', 'highlights'] as const;

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

function rgbaFromHex(value: unknown, fallback = '#000000'): [number, number, number, number] {
  const hex = normalizeHexColor(value, fallback).slice(1);
  return [
    Number.parseInt(hex.substring(0, 2), 16),
    Number.parseInt(hex.substring(2, 4), 16),
    Number.parseInt(hex.substring(4, 6), 16),
    255,
  ];
}

function stringOption<T extends readonly string[]>(
  value: unknown,
  options: T,
  fallback: T[number],
) {
  return typeof value === 'string' && options.includes(value) ? value : fallback;
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
      intensity: 1,
    },
    paramRanges: {
      brightness: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
      contrast: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
      saturation: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
      hue: VIDEO_EFFECT_PARAM_RANGES.hueDegrees,
      intensity: VIDEO_EFFECT_PARAM_RANGES.intensity,
    },
    controls: [
      {
        kind: 'slider',
        key: 'brightness',
        labelKey: 'fastcat.effects.video.color-adjustment.params.brightness',
        min: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMax,
        step: 0.05,
        defaultValue: 1,
        format: percentFromOne,
      },
      {
        kind: 'slider',
        key: 'contrast',
        labelKey: 'fastcat.effects.video.color-adjustment.params.contrast',
        min: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMax,
        step: 0.05,
        defaultValue: 1,
        format: percentFromOne,
      },
      {
        kind: 'slider',
        key: 'saturation',
        labelKey: 'fastcat.effects.video.color-adjustment.params.saturation',
        min: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.colorMultiplier.uiMax,
        step: 0.05,
        defaultValue: 1,
        format: percentFromOne,
      },
      {
        kind: 'slider',
        key: 'hue',
        labelKey: 'fastcat.effects.video.color-adjustment.params.hue',
        min: VIDEO_EFFECT_PARAM_RANGES.hueDegrees.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.hueDegrees.uiMax,
        step: 1,
        defaultValue: 0,
        format: degrees,
      },
      {
        kind: 'slider',
        key: 'intensity',
        labelKey: 'fastcat.effects.video.intensity',
        min: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => {
      const factor = clampFinite(values.intensity, 1);

      const specs = [
        spec('brightness', {
          value: clampRange(
            1.0 + (clampFinite(values.brightness, 1) - 1.0) * factor,
            VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
          ),
        }),
        spec('contrast', {
          value: clampRange(
            1.0 + (clampFinite(values.contrast, 1) - 1.0) * factor,
            VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
          ),
        }),
        spec('saturation', {
          value: clampRange(
            1.0 + (clampFinite(values.saturation, 1) - 1.0) * factor,
            VIDEO_EFFECT_PARAM_RANGES.colorMultiplier,
          ),
        }),
      ];

      const hueVal = clampFinite(values.hue, 0) * factor;
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
      mix: 1,
    },
    paramRanges: {
      strength: VIDEO_EFFECT_PARAM_RANGES.blurRadius,
      mix: VIDEO_EFFECT_PARAM_RANGES.intensity,
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
        defaultValue: 8,
        format: pixels,
      },
      {
        kind: 'toggle',
        key: 'blurPastEdges',
        labelKey: 'fastcat.effects.video.blur.params.blurPastEdges',
      },
      {
        kind: 'slider',
        key: 'mix',
        labelKey: 'fastcat.effects.video.mix',
        min: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
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
        mix: clampRange(
          clampFinite(values.mix ?? values.intensity, 1),
          VIDEO_EFFECT_PARAM_RANGES.intensity,
        ),
      }),
    ],
  },
  {
    type: 'blur-fill',
    name: 'Blur Fill',
    nameKey: 'fastcat.effects.video.blurFill.name',
    description:
      'Fill the frame with a blurred, zoomed copy of the video — show vertical clips in a landscape frame (and vice versa)',
    descriptionKey: 'fastcat.effects.video.blurFill.description',
    icon: 'i-heroicons-rectangle-group',
    target: 'video',
    renderer: 'wgsl-compute',
    defaultValues: {
      fgScale: 1,
      bgScale: 1.1,
      blur: 40,
      bgDim: 0.85,
      bgSaturation: 1,
      tintColor: '#000000',
      tintStrength: 0,
      fgOffsetY: 0,
    },
    paramRanges: {
      fgScale: VIDEO_EFFECT_PARAM_RANGES.fillScale,
      bgScale: VIDEO_EFFECT_PARAM_RANGES.fillScale,
      blur: VIDEO_EFFECT_PARAM_RANGES.blurRadius,
      bgDim: VIDEO_EFFECT_PARAM_RANGES.unit,
      bgSaturation: VIDEO_EFFECT_PARAM_RANGES.saturation,
      tintStrength: VIDEO_EFFECT_PARAM_RANGES.unit,
      fgOffsetY: VIDEO_EFFECT_PARAM_RANGES.offset,
    },
    controls: [
      {
        kind: 'slider',
        key: 'fgScale',
        labelKey: 'fastcat.effects.video.blurFill.params.fgScale',
        min: VIDEO_EFFECT_PARAM_RANGES.fillScale.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.fillScale.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'fgOffsetY',
        labelKey: 'fastcat.effects.video.blurFill.params.fgOffsetY',
        min: VIDEO_EFFECT_PARAM_RANGES.offset.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.offset.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'bgScale',
        labelKey: 'fastcat.effects.video.blurFill.params.bgScale',
        min: VIDEO_EFFECT_PARAM_RANGES.fillScale.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.fillScale.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'blur',
        labelKey: 'fastcat.effects.video.blurFill.params.blur',
        min: VIDEO_EFFECT_PARAM_RANGES.blurRadius.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.blurRadius.uiMax,
        step: 1,
        format: pixels,
      },
      {
        kind: 'slider',
        key: 'bgDim',
        labelKey: 'fastcat.effects.video.blurFill.params.bgDim',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'bgSaturation',
        labelKey: 'fastcat.effects.video.blurFill.params.bgSaturation',
        min: VIDEO_EFFECT_PARAM_RANGES.saturation.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.saturation.uiMax,
        step: 0.01,
        format: percent,
      },
      {
        kind: 'color',
        key: 'tintColor',
        labelKey: 'fastcat.effects.video.blurFill.params.tintColor',
      },
      {
        kind: 'slider',
        key: 'tintStrength',
        labelKey: 'fastcat.effects.video.blurFill.params.tintStrength',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => {
      const hex = (typeof values.tintColor === 'string' ? values.tintColor : '#000000').replace(
        '#',
        '',
      );
      const tintColor: [number, number, number, number] = [
        parseInt(hex.substring(0, 2), 16) || 0,
        parseInt(hex.substring(2, 4), 16) || 0,
        parseInt(hex.substring(4, 6), 16) || 0,
        255,
      ];
      return [
        spec('blur-fill', {
          fg_scale: clampRange(clampFinite(values.fgScale, 1), VIDEO_EFFECT_PARAM_RANGES.fillScale),
          bg_scale: clampRange(
            clampFinite(values.bgScale, 1.1),
            VIDEO_EFFECT_PARAM_RANGES.fillScale,
          ),
          blur: clampRange(clampFinite(values.blur, 40), VIDEO_EFFECT_PARAM_RANGES.blurRadius),
          bg_dim: clampRange(clampFinite(values.bgDim, 0.85), VIDEO_EFFECT_PARAM_RANGES.unit),
          bg_saturation: clampRange(
            clampFinite(values.bgSaturation, 1),
            VIDEO_EFFECT_PARAM_RANGES.saturation,
          ),
          tint_color: tintColor,
          tint_strength: clampRange(
            clampFinite(values.tintStrength, 0),
            VIDEO_EFFECT_PARAM_RANGES.unit,
          ),
          fg_offset_y: clampRange(
            clampFinite(values.fgOffsetY, 0),
            VIDEO_EFFECT_PARAM_RANGES.offset,
          ),
        }),
      ];
    },
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
      knee: 0.5,
      mix: 1,
    },
    paramRanges: {
      threshold: VIDEO_EFFECT_PARAM_RANGES.unit,
      strength: VIDEO_EFFECT_PARAM_RANGES.bloomStrength,
      radius: VIDEO_EFFECT_PARAM_RANGES.bloomRadius,
      knee: VIDEO_EFFECT_PARAM_RANGES.bloomKnee,
      mix: VIDEO_EFFECT_PARAM_RANGES.intensity,
    },
    controls: [
      {
        kind: 'slider',
        key: 'threshold',
        labelKey: 'fastcat.effects.video.bloom.params.threshold',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 0.75,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'strength',
        labelKey: 'fastcat.effects.video.bloom.params.strength',
        min: VIDEO_EFFECT_PARAM_RANGES.bloomStrength.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.bloomStrength.uiMax,
        step: 0.05,
        defaultValue: 0.6,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'radius',
        labelKey: 'fastcat.effects.video.bloom.params.radius',
        min: VIDEO_EFFECT_PARAM_RANGES.bloomRadius.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.bloomRadius.uiMax,
        step: 1,
        defaultValue: 12,
        format: pixels,
      },
      {
        kind: 'slider',
        key: 'knee',
        labelKey: 'fastcat.effects.video.bloom.params.knee',
        min: VIDEO_EFFECT_PARAM_RANGES.bloomKnee.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.bloomKnee.uiMax,
        step: 0.01,
        defaultValue: 0.5,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'mix',
        labelKey: 'fastcat.effects.video.mix',
        min: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('bloom', {
        threshold: clampRange(clampFinite(values.threshold, 0.75), VIDEO_EFFECT_PARAM_RANGES.unit),
        strength: clampRange(
          clampFinite(values.strength, 0.6),
          VIDEO_EFFECT_PARAM_RANGES.bloomStrength,
        ),
        radius: clampRange(clampFinite(values.radius, 12), VIDEO_EFFECT_PARAM_RANGES.bloomRadius),
        knee: clampRange(clampFinite(values.knee, 0.5), VIDEO_EFFECT_PARAM_RANGES.bloomKnee),
        mix: clampRange(
          clampFinite(values.mix ?? values.intensity, 1),
          VIDEO_EFFECT_PARAM_RANGES.intensity,
        ),
      }),
    ],
  },
  {
    type: 'color-tone',
    name: 'Color Tone',
    nameKey: 'fastcat.effects.video.colorTone.name',
    description: 'Tint the image with a selected color',
    descriptionKey: 'fastcat.effects.video.colorTone.description',
    icon: 'i-heroicons-eye-dropper',
    target: 'video',
    renderer: 'wgsl-compute',
    defaultValues: {
      color: '#2f80ff',
      amount: 0.35,
      blendMode: 'soft-light',
      preserveLuminance: true,
      range: 'all',
    },
    paramRanges: {
      amount: VIDEO_EFFECT_PARAM_RANGES.unit,
    },
    controls: [
      {
        kind: 'color',
        key: 'color',
        labelKey: 'fastcat.effects.video.colorTone.params.color',
      },
      {
        kind: 'slider',
        key: 'amount',
        labelKey: 'fastcat.effects.video.colorTone.params.amount',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 0.35,
        format: percent,
      },
      {
        kind: 'select',
        key: 'blendMode',
        labelKey: 'fastcat.effects.video.colorTone.params.blendMode',
        options: [
          { value: 'normal', labelKey: 'fastcat.effects.video.colorTone.options.normal' },
          { value: 'multiply', labelKey: 'fastcat.effects.video.colorTone.options.multiply' },
          { value: 'screen', labelKey: 'fastcat.effects.video.colorTone.options.screen' },
          { value: 'overlay', labelKey: 'fastcat.effects.video.colorTone.options.overlay' },
          { value: 'soft-light', labelKey: 'fastcat.effects.video.colorTone.options.softLight' },
        ],
      },
      {
        kind: 'toggle',
        key: 'preserveLuminance',
        labelKey: 'fastcat.effects.video.colorTone.params.preserveLuminance',
      },
      {
        kind: 'select',
        key: 'range',
        labelKey: 'fastcat.effects.video.colorTone.params.range',
        options: [
          { value: 'all', labelKey: 'fastcat.effects.video.colorTone.options.all' },
          { value: 'shadows', labelKey: 'fastcat.effects.video.colorTone.options.shadows' },
          { value: 'midtones', labelKey: 'fastcat.effects.video.colorTone.options.midtones' },
          { value: 'highlights', labelKey: 'fastcat.effects.video.colorTone.options.highlights' },
        ],
      },
    ],
    toEffectSpecs: (values) => [
      spec('color-tone', {
        color_rgba: rgbaFromHex(values.color, '#2f80ff'),
        amount: clampRange(clampFinite(values.amount, 0.35), VIDEO_EFFECT_PARAM_RANGES.unit),
        blend_mode: stringOption(values.blendMode, COLOR_TONE_BLEND_MODES, 'soft-light'),
        preserve_luminance: values.preserveLuminance !== false,
        range: stringOption(values.range, COLOR_TONE_RANGES, 'all'),
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
      mix: 1,
    },
    paramRanges: {
      amount: VIDEO_EFFECT_PARAM_RANGES.sharpenAmount,
      mix: VIDEO_EFFECT_PARAM_RANGES.intensity,
    },
    controls: [
      {
        kind: 'slider',
        key: 'amount',
        labelKey: 'fastcat.effects.video.tauri.params.amount',
        min: VIDEO_EFFECT_PARAM_RANGES.sharpenAmount.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.sharpenAmount.uiMax,
        step: 0.01,
        defaultValue: 0,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'mix',
        labelKey: 'fastcat.effects.video.mix',
        min: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('sharpen', {
        amount: clampRange(clampFinite(values.amount, 0), VIDEO_EFFECT_PARAM_RANGES.sharpenAmount),
        mix: clampRange(
          clampFinite(values.mix ?? values.intensity, 1),
          VIDEO_EFFECT_PARAM_RANGES.intensity,
        ),
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
      mix: 1,
    },
    paramRanges: {
      size: VIDEO_EFFECT_PARAM_RANGES.pixelSize,
      mix: VIDEO_EFFECT_PARAM_RANGES.intensity,
    },
    controls: [
      {
        kind: 'slider',
        key: 'size',
        labelKey: 'fastcat.effects.video.tauri.pixelate.params.size',
        min: VIDEO_EFFECT_PARAM_RANGES.pixelSize.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.pixelSize.uiMax,
        step: 1,
        defaultValue: 8,
        format: pixels,
      },
      {
        kind: 'slider',
        key: 'mix',
        labelKey: 'fastcat.effects.video.mix',
        min: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('pixelate', {
        size: clampRange(clampFinite(values.size, 8), VIDEO_EFFECT_PARAM_RANGES.pixelSize),
        mix: clampRange(
          clampFinite(values.mix ?? values.intensity, 1),
          VIDEO_EFFECT_PARAM_RANGES.intensity,
        ),
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
      mix: 1,
    },
    paramRanges: {
      strength: VIDEO_EFFECT_PARAM_RANGES.unit,
      radius: VIDEO_EFFECT_PARAM_RANGES.unit,
      softness: VIDEO_EFFECT_PARAM_RANGES.unit,
      mix: VIDEO_EFFECT_PARAM_RANGES.intensity,
    },
    controls: [
      {
        kind: 'slider',
        key: 'strength',
        labelKey: 'fastcat.effects.video.tauri.vignette.params.strength',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 0.35,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'radius',
        labelKey: 'fastcat.effects.video.tauri.vignette.params.radius',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 0.75,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'softness',
        labelKey: 'fastcat.effects.video.tauri.vignette.params.softness',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 0.35,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'mix',
        labelKey: 'fastcat.effects.video.mix',
        min: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('vignette', {
        strength: clampRange(clampFinite(values.strength, 0.35), VIDEO_EFFECT_PARAM_RANGES.unit),
        radius: clampRange(clampFinite(values.radius, 0.75), VIDEO_EFFECT_PARAM_RANGES.unit),
        // Softness floor matches the shader's smoothstep guard (0 would be a
        // degenerate hard edge); the backend also clamps to 0.001.
        softness: clamp(
          clampFinite(values.softness, 0.35),
          0.001,
          VIDEO_EFFECT_PARAM_RANGES.unit.renderMax,
        ),
        mix: clampRange(clampFinite(values.mix, 1), VIDEO_EFFECT_PARAM_RANGES.intensity),
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
      scale: 10,
      mix: 1,
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
      scale: {
        uiMin: 1,
        uiMax: 100,
        animationMin: 1,
        animationMax: 200,
        renderMin: 1,
        renderMax: 500,
      },
      mix: VIDEO_EFFECT_PARAM_RANGES.intensity,
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
        labelKey: 'fastcat.effects.video.noise.params.intensity',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 0.08,
        format: percent,
      },
      {
        kind: 'number',
        key: 'seed',
        labelKey: 'fastcat.effects.video.noise.params.grain',
        min: 0,
        max: 65535,
        step: 1,
      },
      {
        kind: 'slider',
        key: 'scale',
        labelKey: 'fastcat.effects.video.noise.params.scale',
        min: 1,
        max: 100,
        step: 1,
        defaultValue: 10,
        showIf: (values) => values.noiseType === 'perlin' || values.noiseType === 'simplex',
      },
      {
        kind: 'slider',
        key: 'mix',
        labelKey: 'fastcat.effects.video.mix',
        min: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('noise', {
        amount: clampRange(clampFinite(values.amount, 0.08), VIDEO_EFFECT_PARAM_RANGES.unit),
        seed: clamp(Math.round(clampFinite(values.seed, 1)), 0, UINT32_MAX),
        noise_type: values.noiseType || 'white',
        scale: clamp(clampFinite(values.scale, 10), 1, 500),
        mix: clampRange(clampFinite(values.mix, 1), VIDEO_EFFECT_PARAM_RANGES.intensity),
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
      mix: 1,
    },
    paramRanges: {
      amount: VIDEO_EFFECT_PARAM_RANGES.chromaticAmount,
      angle: VIDEO_EFFECT_PARAM_RANGES.hueDegrees,
      mix: VIDEO_EFFECT_PARAM_RANGES.intensity,
    },
    controls: [
      {
        kind: 'slider',
        key: 'amount',
        labelKey: 'fastcat.effects.video.tauri.params.amount',
        min: VIDEO_EFFECT_PARAM_RANGES.chromaticAmount.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.chromaticAmount.uiMax,
        step: 0.5,
        defaultValue: 4,
        format: pixels,
      },
      {
        kind: 'slider',
        key: 'angle',
        labelKey: 'fastcat.effects.video.tauri.params.angle',
        min: VIDEO_EFFECT_PARAM_RANGES.hueDegrees.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.hueDegrees.uiMax,
        step: 1,
        defaultValue: 0,
        format: degrees,
      },
      {
        kind: 'slider',
        key: 'mix',
        labelKey: 'fastcat.effects.video.mix',
        min: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('chromatic-aberration', {
        amount: clampRange(
          clampFinite(values.amount, 4),
          VIDEO_EFFECT_PARAM_RANGES.chromaticAmount,
        ),
        angle_deg: clampRange(clampFinite(values.angle, 0), VIDEO_EFFECT_PARAM_RANGES.hueDegrees),
        mix: clampRange(
          clampFinite(values.mix ?? values.intensity, 1),
          VIDEO_EFFECT_PARAM_RANGES.intensity,
        ),
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
      mix: 1,
    },
    paramRanges: {
      inBlack: VIDEO_EFFECT_PARAM_RANGES.unit,
      inWhite: VIDEO_EFFECT_PARAM_RANGES.unit,
      gamma: VIDEO_EFFECT_PARAM_RANGES.gamma,
      outBlack: VIDEO_EFFECT_PARAM_RANGES.unit,
      outWhite: VIDEO_EFFECT_PARAM_RANGES.unit,
      mix: VIDEO_EFFECT_PARAM_RANGES.intensity,
    },
    controls: [
      {
        kind: 'slider',
        key: 'inBlack',
        labelKey: 'fastcat.effects.video.tauri.levels.params.inBlack',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 0,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'inWhite',
        labelKey: 'fastcat.effects.video.tauri.levels.params.inWhite',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'gamma',
        labelKey: 'fastcat.effects.video.tauri.levels.params.gamma',
        min: VIDEO_EFFECT_PARAM_RANGES.gamma.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.gamma.uiMax,
        step: 0.05,
        defaultValue: 1,
        format: decimal,
      },
      {
        kind: 'slider',
        key: 'outBlack',
        labelKey: 'fastcat.effects.video.tauri.levels.params.outBlack',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 0,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'outWhite',
        labelKey: 'fastcat.effects.video.tauri.levels.params.outWhite',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'mix',
        labelKey: 'fastcat.effects.video.mix',
        min: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('levels', {
        in_black: clampRange(clampFinite(values.inBlack, 0), VIDEO_EFFECT_PARAM_RANGES.unit),
        in_white: clamp(
          clampFinite(values.inWhite, 1),
          0.001,
          VIDEO_EFFECT_PARAM_RANGES.unit.renderMax,
        ),
        gamma: clampRange(clampFinite(values.gamma, 1), VIDEO_EFFECT_PARAM_RANGES.gamma),
        out_black: clampRange(clampFinite(values.outBlack, 0), VIDEO_EFFECT_PARAM_RANGES.unit),
        out_white: clampRange(clampFinite(values.outWhite, 1), VIDEO_EFFECT_PARAM_RANGES.unit),
        mix: clampRange(
          clampFinite(values.mix ?? values.intensity, 1),
          VIDEO_EFFECT_PARAM_RANGES.intensity,
        ),
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
        defaultValue: 0.1,
        format: percent,
      },
      {
        kind: 'slider',
        key: 'smoothness',
        labelKey: 'fastcat.effects.video.tauri.chromaKey.params.smoothness',
        min: VIDEO_EFFECT_PARAM_RANGES.unit.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.unit.uiMax,
        step: 0.01,
        defaultValue: 0.1,
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
          threshold: clampRange(clampFinite(values.threshold, 0.1), VIDEO_EFFECT_PARAM_RANGES.unit),
          smoothness: clamp(
            clampFinite(values.smoothness, 0.1),
            0.0001,
            VIDEO_EFFECT_PARAM_RANGES.unit.renderMax,
          ),
        }),
      ];
    },
  },
  {
    type: 'invert',
    name: 'Invert',
    nameKey: 'fastcat.effects.video.invert.name',
    description: 'Invert colours (negative effect)',
    descriptionKey: 'fastcat.effects.video.invert.description',
    icon: 'i-heroicons-arrow-path',
    target: 'video',
    renderer: 'wgsl-compute',
    defaultValues: {
      mix: 1,
    },
    paramRanges: {
      mix: VIDEO_EFFECT_PARAM_RANGES.intensity,
    },
    controls: [
      {
        kind: 'slider',
        key: 'mix',
        labelKey: 'fastcat.effects.video.invert.params.mix',
        min: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMin,
        max: VIDEO_EFFECT_PARAM_RANGES.intensity.uiMax,
        step: 0.01,
        defaultValue: 1,
        format: percent,
      },
    ],
    toEffectSpecs: (values) => [
      spec('invert', {
        mix: clampRange(clampFinite(values.mix, 1), VIDEO_EFFECT_PARAM_RANGES.intensity),
      }),
    ],
  },
];

const videoManifestByType = new Map(
  videoEffectManifests.map((manifest) => [manifest.type, manifest]),
);

export function getVideoEffectManifestByType(type: string): VideoEffectManifest | undefined {
  return videoManifestByType.get(type);
}
