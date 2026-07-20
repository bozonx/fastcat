import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, computed } from 'vue';
import { useClipTransform } from '~/composables/properties/useClipTransform';
import type { TimelineClipItem, ClipTransform } from '~/timeline/types';

vi.mock('#imports', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function createClip(transform?: Partial<ClipTransform>): TimelineClipItem {
  return {
    id: 'clip-1',
    kind: 'clip',
    trackId: 'track-1',
    clipType: 'media',
    name: 'Test',
    timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
    transform: transform as any,
  } as TimelineClipItem;
}

describe('useClipTransform', () => {
  let emittedTransforms: ClipTransform[];

  beforeEach(() => {
    emittedTransforms = [];
  });

  function createComposable(clip: TimelineClipItem, options: Record<string, any> = {}) {
    const clipRef = ref(clip);
    const trackKindRef = ref(options.trackKind ?? 'video');
    return useClipTransform({
      clip: clipRef,
      trackKind: trackKindRef,
      updateTransform: (next: ClipTransform) => emittedTransforms.push(next),
      isParamAnimated: options.isParamAnimated,
      onAnimatedParamEdit: options.onAnimatedParamEdit,
      getAnimatedDisplayValue: options.getAnimatedDisplayValue,
    });
  }

  it('canEditTransform is true for media clip on video track', () => {
    const c = createComposable(createClip(), { trackKind: 'video' });
    expect(c.canEditTransform.value).toBe(true);
  });

  it('canEditTransform is false for media clip on audio track', () => {
    const c = createComposable(createClip(), { trackKind: 'audio' });
    expect(c.canEditTransform.value).toBe(false);
  });

  it('canEditTransform is false for adjustment clip', () => {
    const clip = createClip();
    (clip as any).clipType = 'adjustment';
    const c = createComposable(clip, { trackKind: 'video' });
    expect(c.canEditTransform.value).toBe(false);
  });

  it('reads scale X as percentage', () => {
    const c = createComposable(createClip({ scale: { x: 1.5, y: 1, linked: true } }));
    expect(c.transformScaleX.value).toBe(150);
  });

  it('writes scale X and updates linked Y', () => {
    const c = createComposable(createClip({ scale: { x: 1, y: 1, linked: true } }));
    c.transformScaleX.value = 200;
    expect(emittedTransforms).toHaveLength(1);
    expect(emittedTransforms[0].scale).toEqual({ x: 2, y: 2, linked: true });
  });

  it('writes scale X without linked Y when unlinked', () => {
    const c = createComposable(createClip({ scale: { x: 1, y: 0.5, linked: false } }));
    c.transformScaleX.value = 200;
    expect(emittedTransforms[0].scale).toEqual({ x: 2, y: 0.5, linked: false });
  });

  it('clamps scale to minimum 0.001', () => {
    const c = createComposable(createClip());
    c.transformScaleX.value = 0;
    expect(emittedTransforms[0].scale!.x).toBe(0.001);
  });

  it('clamps scale to maximum 1000', () => {
    const c = createComposable(createClip());
    c.transformScaleX.value = 999999;
    expect(emittedTransforms[0].scale!.x).toBe(1000);
  });

  it('reads rotation in degrees', () => {
    const c = createComposable(createClip({ rotationDeg: 45 }));
    expect(c.transformRotationDeg.value).toBe(45);
  });

  it('writes rotation clamped to [-36000, 36000]', () => {
    const c = createComposable(createClip());
    c.transformRotationDeg.value = 99999;
    expect(emittedTransforms[0].rotationDeg).toBe(36000);
  });

  it('reads position X', () => {
    const c = createComposable(createClip({ position: { x: 100, y: 50 } }));
    expect(c.transformPosX.value).toBe(100);
  });

  it('writes position X preserving Y', () => {
    const c = createComposable(createClip({ position: { x: 0, y: 50 } }));
    c.transformPosX.value = 100;
    expect(emittedTransforms[0].position).toEqual({ x: 100, y: 50 });
  });

  it('reads anchor preset', () => {
    const c = createComposable(createClip({ anchor: { preset: 'topLeft' } }));
    expect(c.transformAnchorPreset.value).toBe('topLeft');
  });

  it('defaults anchor preset to center', () => {
    const c = createComposable(createClip());
    expect(c.transformAnchorPreset.value).toBe('center');
  });

  it('writes anchor preset to custom with default x/y', () => {
    const c = createComposable(createClip());
    c.transformAnchorPreset.value = 'custom';
    expect(emittedTransforms[0].anchor).toEqual({ preset: 'custom', x: 0.5, y: 0.5 });
  });

  it('writes anchor preset to center', () => {
    const c = createComposable(createClip({ anchor: { preset: 'custom', x: 0.3, y: 0.7 } }));
    c.transformAnchorPreset.value = 'center';
    expect(emittedTransforms[0].anchor).toEqual(expect.objectContaining({ preset: 'center' }));
  });

  it('anchor X setter does nothing when preset is not custom', () => {
    const c = createComposable(createClip({ anchor: { preset: 'center' } }));
    c.transformAnchorX.value = 0.8;
    expect(emittedTransforms).toHaveLength(0);
  });

  it('reads crop values', () => {
    const c = createComposable(createClip({ crop: { top: 10, bottom: 20, left: 5, right: 15 } }));
    expect(c.transformCropTop.value).toBe(10);
    expect(c.transformCropBottom.value).toBe(20);
    expect(c.transformCropLeft.value).toBe(5);
    expect(c.transformCropRight.value).toBe(15);
  });

  it('writes crop top preserving other crop values', () => {
    const c = createComposable(createClip({ crop: { top: 0, bottom: 20, left: 5, right: 15 } }));
    c.transformCropTop.value = 10;
    expect(emittedTransforms[0].crop).toEqual({ top: 10, bottom: 20, left: 5, right: 15 });
  });

  it('toggles flip horizontal', () => {
    const c = createComposable(createClip({ flipHorizontal: false }));
    c.toggleFlipHorizontal();
    expect(emittedTransforms[0].flipHorizontal).toBe(true);
  });

  it('toggles flip vertical', () => {
    const c = createComposable(createClip({ flipVertical: false }));
    c.toggleFlipVertical();
    expect(emittedTransforms[0].flipVertical).toBe(true);
  });

  it('reads flip horizontal as boolean', () => {
    const c = createComposable(createClip({ flipHorizontal: true }));
    expect(c.transformFlipHorizontal.value).toBe(true);
  });

  it('migrates negative scale X to flipHorizontal', () => {
    const c = createComposable(
      createClip({ scale: { x: -1, y: 1, linked: true }, flipHorizontal: false } as any),
    );
    // After migration, flipHorizontal should be true and scale.x positive
    expect(c.transformFlipHorizontal.value).toBe(true);
    expect(c.transformScaleX.value).toBe(100);
  });

  it('migrates negative scale Y to flipVertical', () => {
    const c = createComposable(
      createClip({ scale: { x: 1, y: -2, linked: true }, flipVertical: false } as any),
    );
    expect(c.transformFlipVertical.value).toBe(true);
    expect(c.transformScaleY.value).toBe(200);
  });

  it('resetScale emits default scale', () => {
    const c = createComposable(createClip({ scale: { x: 2, y: 3, linked: false } }));
    c.resetScale();
    expect(emittedTransforms[0].scale).toEqual({ x: 1, y: 1, linked: true });
  });

  it('resetPosition emits zero position', () => {
    const c = createComposable(createClip({ position: { x: 50, y: -30 } }));
    c.resetPosition();
    expect(emittedTransforms[0].position).toEqual({ x: 0, y: 0 });
  });

  it('resetRotation emits zero rotation', () => {
    const c = createComposable(createClip({ rotationDeg: 45 }));
    c.resetRotation();
    expect(emittedTransforms[0].rotationDeg).toBe(0);
  });

  it('resetAnchor emits center preset', () => {
    const c = createComposable(createClip({ anchor: { preset: 'custom', x: 0.3, y: 0.7 } }));
    c.resetAnchor();
    expect(emittedTransforms[0].anchor).toEqual(expect.objectContaining({ preset: 'center' }));
  });

  it('resetCrop emits zero crop', () => {
    const c = createComposable(createClip({ crop: { top: 10, bottom: 20, left: 5, right: 15 } }));
    c.resetCrop();
    expect(emittedTransforms[0].crop).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it('resetAll emits full default transform', () => {
    const c = createComposable(
      createClip({
        scale: { x: 2, y: 3, linked: false },
        position: { x: 50, y: -30 },
        rotationDeg: 45,
        anchor: { preset: 'topLeft' },
        crop: { top: 10, bottom: 5, left: 8, right: 2 },
        flipHorizontal: true,
        flipVertical: true,
      }),
    );
    c.resetAll();
    expect(emittedTransforms[0]).toEqual({
      scale: { x: 1, y: 1, linked: true },
      position: { x: 0, y: 0 },
      rotationDeg: 0,
      anchor: { preset: 'center' },
      crop: { top: 0, bottom: 0, left: 0, right: 0 },
      flipHorizontal: false,
      flipVertical: false,
    });
  });

  it('routes animated scale X edit to onAnimatedParamEdit', () => {
    const spy = vi.fn();
    const c = createComposable(createClip(), {
      isParamAnimated: (path: string) => path === 'transform.scale.x',
      onAnimatedParamEdit: spy,
    });
    c.transformScaleX.value = 150;
    expect(spy).toHaveBeenCalledWith('transform.scale.x', 1.5);
    expect(emittedTransforms).toHaveLength(0);
  });

  it('routes animated rotation edit to onAnimatedParamEdit', () => {
    const spy = vi.fn();
    const c = createComposable(createClip(), {
      isParamAnimated: (path: string) => path === 'transform.rotationDeg',
      onAnimatedParamEdit: spy,
    });
    c.transformRotationDeg.value = 30;
    expect(spy).toHaveBeenCalledWith('transform.rotationDeg', 30);
    expect(emittedTransforms).toHaveLength(0);
  });

  it('routes animated position edit to onAnimatedParamEdit', () => {
    const spy = vi.fn();
    const c = createComposable(createClip(), {
      isParamAnimated: (path: string) => path === 'transform.position.x',
      onAnimatedParamEdit: spy,
    });
    c.transformPosX.value = 100;
    expect(spy).toHaveBeenCalledWith('transform.position.x', 100);
    expect(emittedTransforms).toHaveLength(0);
  });

  it('routes animated crop edit to onAnimatedParamEdit', () => {
    const spy = vi.fn();
    const c = createComposable(createClip(), {
      isParamAnimated: (path: string) => path === 'transform.crop.top',
      onAnimatedParamEdit: spy,
    });
    c.transformCropTop.value = 15;
    expect(spy).toHaveBeenCalledWith('transform.crop.top', 15);
    expect(emittedTransforms).toHaveLength(0);
  });

  it('routes animated flip edit to onAnimatedParamEdit', () => {
    const spy = vi.fn();
    const c = createComposable(createClip({ flipHorizontal: false }), {
      isParamAnimated: (path: string) => path === 'transform.flipHorizontal',
      onAnimatedParamEdit: spy,
    });
    c.toggleFlipHorizontal();
    expect(spy).toHaveBeenCalledWith('transform.flipHorizontal', 1);
    expect(emittedTransforms).toHaveLength(0);
  });

  it('getAnimatedDisplayValue overrides static value for scale X', () => {
    const c = createComposable(createClip({ scale: { x: 1, y: 1, linked: true } }), {
      isParamAnimated: (path: string) => path === 'transform.scale.x',
      getAnimatedDisplayValue: (_path: string, staticValue: number) =>
        _path === 'transform.scale.x' ? 2.5 : staticValue,
    });
    // Should show 250 (2.5 * 100) instead of 100 (1 * 100)
    expect(c.transformScaleX.value).toBe(250);
  });

  it('getAnimatedDisplayValue overrides static value for rotation', () => {
    const c = createComposable(createClip({ rotationDeg: 0 }), {
      isParamAnimated: (path: string) => path === 'transform.rotationDeg',
      getAnimatedDisplayValue: (_path: string, staticValue: number) =>
        _path === 'transform.rotationDeg' ? 90 : staticValue,
    });
    expect(c.transformRotationDeg.value).toBe(90);
  });

  it('scale linked toggle sets Y equal to X when linking', () => {
    const c = createComposable(createClip({ scale: { x: 2, y: 3, linked: false } }));
    c.transformScaleLinked.value = true;
    expect(emittedTransforms[0].scale).toEqual({ x: 2, y: 2, linked: true });
  });

  it('scale linked toggle preserves X and Y when unlinking', () => {
    const c = createComposable(createClip({ scale: { x: 2, y: 3, linked: true } }));
    c.transformScaleLinked.value = false;
    expect(emittedTransforms[0].scale).toEqual({ x: 2, y: 3, linked: false });
  });

  it('handles missing transform gracefully', () => {
    const c = createComposable(createClip(undefined as any));
    expect(c.transformScaleX.value).toBe(100);
    expect(c.transformRotationDeg.value).toBe(0);
    expect(c.transformPosX.value).toBe(0);
    expect(c.transformAnchorPreset.value).toBe('center');
  });

  it('handles NaN values gracefully', () => {
    const c = createComposable(createClip({ scale: { x: NaN, y: Infinity, linked: true } } as any));
    expect(c.transformScaleX.value).toBe(100);
    expect(c.transformScaleY.value).toBe(100);
  });

  it('anchorPresetOptions has 6 options', () => {
    const c = createComposable(createClip());
    expect(c.anchorPresetOptions.value).toHaveLength(6);
    const values = c.anchorPresetOptions.value.map((o: { value: string }) => o.value);
    expect(values).toEqual([
      'center',
      'topLeft',
      'topRight',
      'bottomLeft',
      'bottomRight',
      'custom',
    ]);
  });
});
