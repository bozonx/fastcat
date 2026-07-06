/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  effectiveClipTransform,
  resolveClipAnimationOverlay,
} from '~/utils/video-editor/compositor/AnimationOverlay';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';
import type { ClipAnimations } from '~/timeline/types';

// Minimal CompositorClip stub — the overlay helper only touches a handful of
// fields, so we cast a partial object rather than build a full runtime clip.
const clip = (over: Partial<CompositorClip>): CompositorClip =>
  ({ startUs: 0, clipKind: 'image', ...over }) as unknown as CompositorClip;

const anims = (a: ClipAnimations): ClipAnimations => a;

describe('resolveClipAnimationOverlay', () => {
  it('clears the overlay for a clip without keyframes', () => {
    const c = clip({ animatedOpacity: 0.3, animatedTransform: { rotationDeg: 5 } });
    resolveClipAnimationOverlay(c, 1000);
    expect(c.animatedOpacity).toBeUndefined();
    expect(c.animatedTransform).toBeUndefined();
  });

  it('samples opacity to animatedOpacity without touching transform', () => {
    const c = clip({
      animations: anims({
        opacity: {
          keyframes: [
            { tUs: 0, value: 0, easing: 'linear' },
            { tUs: 1000, value: 1, easing: 'linear' },
          ],
        },
      }),
    });
    resolveClipAnimationOverlay(c, 500); // clip.startUs = 0 -> local 500
    expect(c.animatedOpacity).toBeCloseTo(0.5, 6);
    expect(c.animatedTransform).toBeUndefined();
  });

  it('uses source-relative time from clip trim and speed', () => {
    const c = clip({
      startUs: 2000,
      sourceStartUs: 10_000,
      sourceRangeDurationUs: 2_000,
      speed: 2,
      animations: anims({
        opacity: {
          keyframes: [
            { tUs: 10_000, value: 0, easing: 'linear' },
            { tUs: 12_000, value: 1, easing: 'linear' },
          ],
        },
      }),
    });
    resolveClipAnimationOverlay(c, 2500); // source time 11_000
    expect(c.animatedOpacity).toBeCloseTo(0.5, 6);
  });

  it('samples reverse clips from the end of the source range', () => {
    const c = clip({
      startUs: 2000,
      sourceStartUs: 10_000,
      sourceRangeDurationUs: 2_000,
      speed: -1,
      animations: anims({
        opacity: {
          keyframes: [
            { tUs: 10_000, value: 0, easing: 'linear' },
            { tUs: 12_000, value: 1, easing: 'linear' },
          ],
        },
      }),
    });
    resolveClipAnimationOverlay(c, 3000); // reverse source time 11_000
    expect(c.animatedOpacity).toBeCloseTo(0.5, 6);
  });

  it('merges animated transform onto the static transform, preserving crop/anchor', () => {
    const c = clip({
      transform: {
        position: { x: 10, y: 20 },
        scale: { x: 1, y: 1 },
        rotationDeg: 0,
        crop: { top: 5 },
        anchor: { preset: 'center' },
      },
      animations: anims({
        'transform.rotationDeg': {
          keyframes: [
            { tUs: 0, value: 0, easing: 'linear' },
            { tUs: 1000, value: 90, easing: 'linear' },
          ],
        },
        'transform.position.x': {
          keyframes: [
            { tUs: 0, value: 0, easing: 'linear' },
            { tUs: 1000, value: 100, easing: 'linear' },
          ],
        },
      }),
    });
    resolveClipAnimationOverlay(c, 500);
    expect(c.animatedTransform?.rotationDeg).toBeCloseTo(45, 6);
    expect(c.animatedTransform?.position?.x).toBeCloseTo(50, 6);
    // y not animated -> falls back to static
    expect(c.animatedTransform?.position?.y).toBe(20);
    // untouched fields carried over
    expect(c.animatedTransform?.crop?.top).toBe(5);
    expect(c.animatedTransform?.anchor?.preset).toBe('center');
  });

  it('samples anchor, crop and flip transform keys', () => {
    const c = clip({
      transform: {
        anchor: { preset: 'center' },
        crop: { top: 0, bottom: 0, left: 0, right: 0 },
        flipHorizontal: false,
      },
      animations: anims({
        'transform.anchor.x': {
          keyframes: [
            { tUs: 0, value: 0, easing: 'linear' },
            { tUs: 1000, value: 1, easing: 'linear' },
          ],
        },
        'transform.crop.top': {
          keyframes: [
            { tUs: 0, value: 0, easing: 'linear' },
            { tUs: 1000, value: 40, easing: 'linear' },
          ],
        },
        'transform.flipHorizontal': {
          keyframes: [
            { tUs: 0, value: 0, easing: 'hold' },
            { tUs: 1000, value: 1, easing: 'hold' },
          ],
        },
      }),
    });

    resolveClipAnimationOverlay(c, 500);
    expect(c.animatedTransform?.anchor).toEqual({ preset: 'custom', x: 0.5, y: 0.5 });
    expect(c.animatedTransform?.crop?.top).toBeCloseTo(20);
    expect(c.animatedTransform?.flipHorizontal).toBe(false);

    resolveClipAnimationOverlay(c, 1000);
    expect(c.animatedTransform?.flipHorizontal).toBe(true);
  });
});

describe('effectiveClipTransform', () => {
  it('prefers the animated overlay when present', () => {
    const c = clip({
      transform: { rotationDeg: 0 },
      animatedTransform: { rotationDeg: 30 },
    });
    expect(effectiveClipTransform(c)?.rotationDeg).toBe(30);
  });

  it('falls back to the static transform, honoring transformActive', () => {
    expect(effectiveClipTransform(clip({ transform: { rotationDeg: 10 } }))?.rotationDeg).toBe(10);
    expect(
      effectiveClipTransform(clip({ transform: { rotationDeg: 10 }, transformActive: false })),
    ).toBeUndefined();
  });

  it('overlay wins even when transformActive is false', () => {
    const c = clip({
      transform: { rotationDeg: 10 },
      transformActive: false,
      animatedTransform: { rotationDeg: 90 },
    });
    expect(effectiveClipTransform(c)?.rotationDeg).toBe(90);
  });

  it('resolves animatedEffectSpecs from baked effects (even with no transform/opacity keyframes)', () => {
    const c = clip({
      bakedEffects: {
        baseSpecs: [{ type: 'gaussian-blur', radius: 8 } as never],
        fields: [
          {
            specIndex: 0,
            field: 'radius',
            kind: 'number',
            keyframes: [
              { tUs: 0, value: 8, easing: 'linear' },
              { tUs: 1000, value: 64, easing: 'linear' },
            ],
          },
        ],
      },
    });
    resolveClipAnimationOverlay(c, 500); // local 500 -> midpoint
    expect((c.animatedEffectSpecs?.[0] as Record<string, unknown>).radius).toBeCloseTo(36);
    // transform/opacity overlays stay cleared
    expect(c.animatedTransform).toBeUndefined();
    expect(c.animatedOpacity).toBeUndefined();
  });

  it('clears animatedEffectSpecs when a clip has no baked effects', () => {
    const c = clip({ animatedEffectSpecs: [{ type: 'x' } as never] });
    resolveClipAnimationOverlay(c, 500);
    expect(c.animatedEffectSpecs).toBeUndefined();
  });
});
