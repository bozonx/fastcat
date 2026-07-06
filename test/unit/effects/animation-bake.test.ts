/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { bakeClipEffectAnimations, patchBakedEffectSpecs } from '~/effects/animation-bake';
import type { ClipAnimations, ClipEffect } from '~/timeline/types';

const linTrack = (a: [number, number], b: [number, number]) => ({
  keyframes: [
    { tUs: a[0], value: a[1], easing: 'linear' as const },
    { tUs: b[0], value: b[1], easing: 'linear' as const },
  ],
});

function fx(overrides: Partial<ClipEffect> & { type: string }): ClipEffect {
  return { id: 'fx1', enabled: true, target: 'video', ...overrides } as ClipEffect;
}

describe('bakeClipEffectAnimations', () => {
  it('bakes a direct-passthrough numeric param (blur radius) and patches it over time', () => {
    const effects = [fx({ type: 'blur', radius: 8 })];
    const animations: ClipAnimations = {
      'effect.fx1.radius': linTrack([0, 8], [1_000_000, 64]),
    };

    const baked = bakeClipEffectAnimations(effects, animations)!;
    expect(baked).toBeTruthy();
    // Base spec is the gaussian-blur produced by the manifest.
    expect(baked.baseSpecs[0]?.type).toBe('gaussian-blur');
    const radiusField = baked.fields.find((f) => f.field === 'radius');
    expect(radiusField).toBeTruthy();

    const at0 = patchBakedEffectSpecs(baked, 0)[0] as Record<string, unknown>;
    const atMid = patchBakedEffectSpecs(baked, 500_000)[0] as Record<string, unknown>;
    const at1 = patchBakedEffectSpecs(baked, 1_000_000)[0] as Record<string, unknown>;
    expect(at0.radius).toBeCloseTo(8);
    expect(atMid.radius).toBeCloseTo(36); // midpoint of 8..64
    expect(at1.radius).toBeCloseTo(64);
  });

  it('handles the intensity coupling of color-adjustment (value = 1+(b-1)*intensity)', () => {
    const effects = [
      fx({ type: 'color-adjustment', brightness: 1, contrast: 1, saturation: 1, intensity: 1 }),
    ];
    const animations: ClipAnimations = {
      'effect.fx1.brightness': linTrack([0, 1], [1_000_000, 3]),
    };
    const baked = bakeClipEffectAnimations(effects, animations)!;

    // brightness spec value tracks brightness*intensity(=1): 1 -> 3
    const specs0 = patchBakedEffectSpecs(baked, 0);
    const specsMid = patchBakedEffectSpecs(baked, 500_000);
    const specs1 = patchBakedEffectSpecs(baked, 1_000_000);
    const brightness = (s: Record<string, unknown>[]) =>
      (s.find((x) => x.type === 'brightness') as Record<string, unknown>).value as number;
    expect(brightness(specs0 as never)).toBeCloseTo(1);
    expect(brightness(specsMid as never)).toBeCloseTo(2);
    expect(brightness(specs1 as never)).toBeCloseTo(3);
  });

  it('keeps a conditionally-emitted spec (hue) in the base and animates it to ~0', () => {
    const effects = [
      fx({
        type: 'color-adjustment',
        brightness: 1,
        contrast: 1,
        saturation: 1,
        hue: 0,
        intensity: 1,
      }),
    ];
    const animations: ClipAnimations = {
      'effect.fx1.hue': linTrack([0, 0], [1_000_000, 90]),
    };
    const baked = bakeClipEffectAnimations(effects, animations)!;
    // hue spec only exists when hue != 0; base picks the richest sample so it's present.
    expect(baked.baseSpecs.some((s) => s.type === 'hue')).toBe(true);

    const hueAt = (t: number) => {
      const s = patchBakedEffectSpecs(baked, t).find((x) => x.type === 'hue') as
        | Record<string, unknown>
        | undefined;
      return (s?.degrees as number) ?? 0;
    };
    expect(hueAt(0)).toBeCloseTo(0, 1);
    expect(hueAt(1_000_000)).toBeCloseTo(90, 1);
  });

  it('subdivides eased segments so the smoothstep midpoint is not linear', () => {
    const effects = [fx({ type: 'blur', radius: 0 })];
    const animations: ClipAnimations = {
      'effect.fx1.radius': {
        keyframes: [
          { tUs: 0, value: 0, easing: 'ease' },
          { tUs: 1_000_000, value: 100, easing: 'linear' },
        ],
      },
    };
    const baked = bakeClipEffectAnimations(effects, animations)!;
    // smoothstep(0.5) = 0.5 so midpoint still 50, but a quarter point differs from linear (25).
    const quarter = patchBakedEffectSpecs(baked, 250_000)[0] as Record<string, unknown>;
    // smoothstep(0.25) = 0.15625 -> ~15.6, clearly below the linear 25.
    expect(quarter.radius as number).toBeLessThan(22);
    expect(baked.fields[0]!.keyframes.length).toBeGreaterThan(2);
  });

  it('bakes a boolean effect param (blur bleed) as a stepped field', () => {
    const effects = [fx({ type: 'blur', radius: 8, blurPastEdges: false })];
    const animations: ClipAnimations = {
      'effect.fx1.blurPastEdges': {
        keyframes: [
          { tUs: 0, value: 0, easing: 'hold' },
          { tUs: 1_000_000, value: 1, easing: 'hold' },
        ],
      },
    };
    const baked = bakeClipEffectAnimations(effects, animations)!;
    const bleedField = baked.fields.find((f) => f.field === 'bleed');
    expect(bleedField?.kind).toBe('bool');

    const bleedAt = (t: number) =>
      (patchBakedEffectSpecs(baked, t)[0] as Record<string, unknown>).bleed;
    expect(bleedAt(0)).toBe(false);
    expect(bleedAt(1_000_000)).toBe(true);
  });

  it('returns undefined when no effect params are animated', () => {
    expect(bakeClipEffectAnimations([fx({ type: 'blur', radius: 8 })], undefined)).toBeUndefined();
    expect(
      bakeClipEffectAnimations([fx({ type: 'blur', radius: 8 })], {
        opacity: { keyframes: [{ tUs: 0, value: 1, easing: 'linear' }] },
      }),
    ).toBeUndefined();
  });

  it('ignores colour (dotted) keys in v1 baking', () => {
    const effects = [fx({ type: 'blur-fill', tintColor: '#ffffff', tintStrength: 0 })];
    const animations: ClipAnimations = {
      'effect.fx1.tintColor.r': linTrack([0, 0], [1_000_000, 1]),
    };
    // Only a dotted colour key animates -> nothing bakeable in v1.
    expect(bakeClipEffectAnimations(effects, animations)).toBeUndefined();
  });
});
