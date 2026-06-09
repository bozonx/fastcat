/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getAllVideoEffectManifests, getVideoEffectManifest, initEffects } from '~/effects';
import { getAllTransitionManifests, getTransitionManifest, initTransitions } from '~/transitions';
import { buildEffectSpecs } from '~/utils/native-monitor-scene';

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
      'hue',
      'levels',
      'chroma-key',
    ]);
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
      'fade-to-black',
      'circle',
      'zoom',
      'bloom',
    ]);
    expect(types).not.toContain('cube');
    expect(types).not.toContain('card-swap');
    expect(getTransitionManifest('dissolve')?.renderer).toBe('wgpu');
    expect(getTransitionManifest('dissolve')?.createFilter).toBeUndefined();
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
});
