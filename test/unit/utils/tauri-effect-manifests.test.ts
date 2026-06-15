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

  it('exposes separate UI and animation ranges for video effect params', () => {
    const blur = getVideoEffectManifest('blur');
    const bloom = getVideoEffectManifest('bloom');

    expect(blur?.paramRanges?.strength).toMatchObject({
      uiMax: 100,
      animationMax: 512,
      renderMax: 1024,
    });
    expect(bloom?.paramRanges?.radius).toMatchObject({
      uiMax: 32,
      animationMax: 256,
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
      { type: 'gaussian-blur', radius: 500, bleed: false },
      { type: 'bloom', threshold: 0.4, strength: 3.5, radius: 220 },
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
      { type: 'gaussian-blur', radius: 96, bleed: false },
      { type: 'noise', amount: 1, seed: 4_294_967_295 },
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

    expect(specs).toEqual([{ type: 'gaussian-blur', radius: 24, bleed: true }]);
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
});
