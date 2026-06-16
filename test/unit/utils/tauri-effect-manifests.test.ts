/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getAllVideoEffectManifests,
  getVideoEffectManifest,
  initEffects,
  buildEffectSpecs,
} from '~/effects';
import { getAllTransitionManifests, getTransitionManifest, initTransitions } from '~/transitions';

declare global {
  var __TAURI_INTERNALS__: unknown;
}

describe('unified video effect manifests', () => {
  beforeEach(() => {
    globalThis.__TAURI_INTERNALS__ = {};
    initEffects();
    initTransitions();
  });

  afterEach(() => {
    delete globalThis.__TAURI_INTERNALS__;
  });

  it('exposes the unified WGSL video effect catalog instead of Pixi-only video effects', () => {
    const types = getAllVideoEffectManifests().map((manifest) => manifest.type);

    expect(types).toEqual([
      'color-adjustment',
      'blur',
      'blur-fill',
      'bloom',
      'sharpen',
      'pixelate',
      'vignette',
      'noise',
      'chromatic-aberration',
      'levels',
      'chroma-key',
    ]);
    expect(types).not.toContain('hue');
    expect(getVideoEffectManifest('hue')).toBeDefined();
    expect(getVideoEffectManifest('hue')?.hidden).toBe(true);
    expect(types).not.toContain('ascii');
    expect(types).not.toContain('crt');
    expect(getVideoEffectManifest('blur')?.renderer).toBe('wgsl-compute');
    expect(typeof getVideoEffectManifest('blur')?.toEffectSpecs).toBe('function');
  });

  it('exposes the Tauri transition catalog instead of Pixi shader filters', () => {
    const types = getAllTransitionManifests().map((manifest) => manifest.type);

    expect(types).toEqual([
      'dissolve',
      'wipe',
      'slide',
      'clock',
      'barn-door',
      'fade-to-black',
      'circle',
      'rectangle',
      'blinds',
      'zoom',
      'bloom',
      'cube',
      'card-swap',
      'falling-card',
    ]);
    expect(getTransitionManifest('dissolve')?.renderer).toBe('wgpu');
    expect(getTransitionManifest('dissolve')?.createFilter).toBeUndefined();
    expect(getTransitionManifest('dissolve')?.supportedModes).toEqual([
      'adjacent',
      'background',
      'transparent',
    ]);
    expect(getTransitionManifest('wipe')?.supportedModes).toEqual(['adjacent']);
    for (const manifest of getAllTransitionManifests()) {
      expect(manifest.toTauriSpec, manifest.type).toBeTypeOf('function');
    }
  });

  it('serializes enabled video effects into native EffectSpec payloads', () => {
    const specs = buildEffectSpecs([
      {
        id: 'fx-1',
        type: 'blur',
        enabled: true,
        target: 'video',
        strength: 12,
      },
      {
        id: 'fx-2',
        type: 'color-adjustment',
        enabled: true,
        target: 'video',
        brightness: 1.2,
        contrast: 0.8,
        saturation: 1.1,
      },
      {
        id: 'fx-3',
        type: 'noise',
        enabled: false,
        target: 'video',
        amount: 1,
      },
      {
        id: 'fx-4',
        type: 'audio-echo',
        enabled: true,
        target: 'audio',
      },
    ]);

    expect(specs).toEqual([
      {
        type: 'gaussian-blur',
        radius: 12,
        bleed: false,
        blur_type: 'gaussian',
        mix: 1,
      },
      {
        type: 'brightness',
        value: 1.2,
      },
      {
        type: 'contrast',
        value: 0.8,
      },
      {
        type: 'saturation',
        value: 1.1,
      },
    ]);
  });

  it('serializes blur-fill with snake_case ratio params and defaults', () => {
    const manifest = getVideoEffectManifest('blur-fill');
    expect(manifest?.renderer).toBe('wgsl-compute');

    // Explicit values pass through (UI ratios → spec ratios).
    expect(
      buildEffectSpecs([
        {
          id: 'bf-1',
          type: 'blur-fill',
          enabled: true,
          target: 'video',
          fgScale: 0.9,
          bgScale: 1.3,
          blur: 60,
          bgDim: 0.7,
          bgSaturation: 1.2,
          tintColor: '#0000ff',
          tintStrength: 0.5,
          fgOffsetY: -0.1,
        },
      ]),
    ).toEqual([
      {
        type: 'blur-fill',
        fg_scale: 0.9,
        bg_scale: 1.3,
        blur: 60,
        bg_dim: 0.7,
        bg_saturation: 1.2,
        tint_color: [0, 0, 255, 255],
        tint_strength: 0.5,
        fg_offset_y: -0.1,
      },
    ]);

    // Missing values fall back to the manifest defaults.
    expect(
      buildEffectSpecs([{ id: 'bf-2', type: 'blur-fill', enabled: true, target: 'video' }]),
    ).toEqual([
      {
        type: 'blur-fill',
        fg_scale: 1,
        bg_scale: 1.1,
        blur: 40,
        bg_dim: 0.85,
        bg_saturation: 1,
        tint_color: [0, 0, 0, 255],
        tint_strength: 0,
        fg_offset_y: 0,
      },
    ]);
  });

  it('exposes separate UI and animation ranges for video effect params', () => {
    const blur = getVideoEffectManifest('blur');
    const bloom = getVideoEffectManifest('bloom');

    expect(blur?.paramRanges?.strength).toMatchObject({
      uiMax: 100,
      animationMax: 512,
      renderMax: 1024,
    });
    expect(bloom?.paramRanges?.radius).toMatchObject({
      uiMax: 100,
      animationMax: 512,
      renderMax: 512,
    });
  });

  it('serializes animation-scale values up to renderer hard caps', () => {
    const specs = buildEffectSpecs([
      {
        id: 'fx-blur',
        type: 'blur',
        enabled: true,
        target: 'video',
        strength: 500,
      },
      {
        id: 'fx-bloom',
        type: 'bloom',
        enabled: true,
        target: 'video',
        threshold: 0.4,
        strength: 3.5,
        radius: 220,
      },
      {
        id: 'fx-color',
        type: 'color-adjustment',
        enabled: true,
        target: 'video',
        brightness: 3,
        contrast: 3.5,
        saturation: 4,
      },
    ]);

    expect(specs).toEqual([
      { type: 'gaussian-blur', radius: 500, bleed: false, blur_type: 'gaussian', mix: 1 },
      { type: 'bloom', threshold: 0.4, strength: 3.5, radius: 220, knee: 0.5, mix: 1 },
      { type: 'brightness', value: 3 },
      { type: 'contrast', value: 3.5 },
      { type: 'saturation', value: 4 },
    ]);
  });

  it('normalizes legacy blur radius and clamps unsafe numeric values', () => {
    const specs = buildEffectSpecs([
      {
        id: 'fx-radius',
        type: 'blur',
        enabled: true,
        target: 'video',
        radius: 96,
      },
      {
        id: 'fx-seed',
        type: 'noise',
        enabled: true,
        target: 'video',
        amount: 2,
        seed: Number.MAX_SAFE_INTEGER,
      },
    ]);

    expect(specs).toEqual([
      { type: 'gaussian-blur', radius: 96, bleed: false, blur_type: 'gaussian', mix: 1 },
      { type: 'noise', amount: 1, seed: 4_294_967_295, noise_type: 'white', scale: 10, mix: 1 },
    ]);
  });

  it('emits bleed:true on blur when "blur past edges" is enabled', () => {
    const specs = buildEffectSpecs([
      {
        id: 'fx-bleed',
        type: 'blur',
        enabled: true,
        target: 'video',
        strength: 24,
        blurPastEdges: true,
      },
    ]);

    expect(specs).toEqual([{ type: 'gaussian-blur', radius: 24, bleed: true, blur_type: 'gaussian', mix: 1 }]);
  });

  it('serializes color-adjustment with non-zero hue value and omits it when zero', () => {
    const specsWithHue = buildEffectSpecs([
      {
        id: 'fx-color-hue',
        type: 'color-adjustment',
        enabled: true,
        target: 'video',
        brightness: 1,
        contrast: 1,
        saturation: 1,
        hue: 90,
      },
    ]);

    expect(specsWithHue).toEqual([
      { type: 'brightness', value: 1 },
      { type: 'contrast', value: 1 },
      { type: 'saturation', value: 1 },
      { type: 'hue', degrees: 90 },
    ]);

    const specsWithoutHue = buildEffectSpecs([
      {
        id: 'fx-color-no-hue',
        type: 'color-adjustment',
        enabled: true,
        target: 'video',
        brightness: 1,
        contrast: 1,
        saturation: 1,
        hue: 0,
      },
    ]);

    expect(specsWithoutHue).toEqual([
      { type: 'brightness', value: 1 },
      { type: 'contrast', value: 1 },
      { type: 'saturation', value: 1 },
    ]);
  });

  it('serializes box and radial blur types, and perlin and simplex noise types', () => {
    const specs = buildEffectSpecs([
      {
        id: 'fx-box-blur',
        type: 'blur',
        enabled: true,
        target: 'video',
        strength: 20,
        blurType: 'box',
      },
      {
        id: 'fx-radial-blur',
        type: 'blur',
        enabled: true,
        target: 'video',
        strength: 30,
        blurType: 'radial',
      },
      {
        id: 'fx-perlin-noise',
        type: 'noise',
        enabled: true,
        target: 'video',
        amount: 0.5,
        seed: 42,
        noiseType: 'perlin',
        scale: 25,
      },
    ]);

    expect(specs).toEqual([
      { type: 'gaussian-blur', radius: 20, bleed: false, blur_type: 'box', mix: 1 },
      { type: 'gaussian-blur', radius: 30, bleed: false, blur_type: 'radial', mix: 1 },
      { type: 'noise', amount: 0.5, seed: 42, noise_type: 'perlin', scale: 25, mix: 1 },
    ]);
  });

  it('applies mix to blend effect with original, not scale parameters', () => {
    const specs = buildEffectSpecs([
      {
        id: 'fx-blur-mix',
        type: 'blur',
        enabled: true,
        target: 'video',
        strength: 12,
        mix: 0.5,
      },
      {
        id: 'fx-color-intensity',
        type: 'color-adjustment',
        enabled: true,
        target: 'video',
        brightness: 2.0,
        contrast: 1.0,
        saturation: 1.0,
        hue: 80,
        intensity: 0.75, // color-adjustment still uses intensity as master fader
      },
      {
        id: 'fx-pixelate-mix',
        type: 'pixelate',
        enabled: true,
        target: 'video',
        size: 9,
        mix: 0.5,
      },
      {
        id: 'fx-levels-mix',
        type: 'levels',
        enabled: true,
        target: 'video',
        inBlack: 0.2,
        inWhite: 0.8,
        gamma: 1.6,
        outBlack: 0.1,
        outWhite: 0.9,
        mix: 0.5,
      },
    ]);

    expect(specs).toEqual([
      // Blur: radius stays as-is, mix blends with original
      { type: 'gaussian-blur', radius: 12, bleed: false, blur_type: 'gaussian', mix: 0.5 },
      // Color-adjustment: intensity still scales parameters
      { type: 'brightness', value: 1.75 },
      { type: 'contrast', value: 1.0 },
      { type: 'saturation', value: 1.0 },
      { type: 'hue', degrees: 60 },
      // Pixelate: size stays as-is, mix controls blend with original
      { type: 'pixelate', size: 9, mix: 0.5 },
      // Levels: params stay as-is, mix blends with original
      {
        type: 'levels',
        in_black: 0.2,
        in_white: 0.8,
        gamma: 1.6,
        out_black: 0.1,
        out_white: 0.9,
        mix: 0.5,
      },
    ]);
  });

  it('maps legacy pixelate intensity to mix for backward compatibility', () => {
    const specs = buildEffectSpecs([
      {
        id: 'fx-pixelate-legacy',
        type: 'pixelate',
        enabled: true,
        target: 'video',
        size: 12,
        intensity: 0.3, // legacy field should be treated as mix
      },
    ]);

    expect(specs).toEqual([
      { type: 'pixelate', size: 12, mix: 0.3 },
    ]);
  });
});
