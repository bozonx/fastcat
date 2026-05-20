/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { LayoutApplier } from '~/utils/video-editor/compositor/LayoutApplier';

function createMockSprite() {
  return {
    visible: true,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    rotation: 0,
    scale: { x: 1, y: 1 },
    anchor: { set: () => {} },
    alpha: 1,
    parent: null,
    mask: null,
    texture: { source: {} },
  } as any;
}

describe('LayoutApplier', () => {
  const context = { width: 1920, height: 1080 };
  const applier = new LayoutApplier(context);

  it('adds rotation for 90° sourceRotation with logical dimensions', () => {
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-1',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sourceStartUs: 0,
      sourceRangeDurationUs: 1_000_000,
      sourceDurationUs: 1_000_000,
      sprite,
      clipKind: 'video' as const,
      clipType: 'media' as const,
      sourceKind: 'videoFrame' as const,
      imageSource: { width: 1080, height: 1920, resize: () => {}, update: () => {}, resource: null } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      sourceRotation: 90,
    };

    // Logical dimensions (displayWidth/displayHeight) already account for rotation.
    applier.applySpriteLayout(1080, 1920, clip as any);

    const expectedScale = Math.min(1080 / 1080, 1080 / 1920);
    expect(sprite.width).toBeCloseTo(1080 * expectedScale);
    expect(sprite.height).toBeCloseTo(1920 * expectedScale);
    expect(sprite.rotation).toBeCloseTo((Math.PI / 2));
  });

  it('adds rotation for 270° sourceRotation with logical dimensions', () => {
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-2',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sourceStartUs: 0,
      sourceRangeDurationUs: 1_000_000,
      sourceDurationUs: 1_000_000,
      sprite,
      clipKind: 'video' as const,
      clipType: 'media' as const,
      sourceKind: 'videoFrame' as const,
      imageSource: { width: 1080, height: 1920, resize: () => {}, update: () => {}, resource: null } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      sourceRotation: 270,
    };

    applier.applySpriteLayout(1080, 1920, clip as any);

    const expectedScale = Math.min(1080 / 1080, 1080 / 1920);
    expect(sprite.width).toBeCloseTo(1080 * expectedScale);
    expect(sprite.height).toBeCloseTo(1920 * expectedScale);
    expect(sprite.rotation).toBeCloseTo((Math.PI * 1.5));
  });

  it('does not swap dimensions when sourceRotation is 0', () => {
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-3',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sourceStartUs: 0,
      sourceRangeDurationUs: 1_000_000,
      sourceDurationUs: 1_000_000,
      sprite,
      clipKind: 'video' as const,
      clipType: 'media' as const,
      sourceKind: 'videoFrame' as const,
      imageSource: { width: 1920, height: 1080, resize: () => {}, update: () => {}, resource: null } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
    };

    applier.applySpriteLayout(1920, 1080, clip as any);

    expect(sprite.width).toBeCloseTo(1920);
    expect(sprite.height).toBeCloseTo(1080);
    expect(sprite.rotation).toBeCloseTo(0);
  });

  it('combines user transform rotation with sourceRotation', () => {
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-4',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sourceStartUs: 0,
      sourceRangeDurationUs: 1_000_000,
      sourceDurationUs: 1_000_000,
      sprite,
      clipKind: 'video' as const,
      clipType: 'media' as const,
      sourceKind: 'videoFrame' as const,
      imageSource: { width: 1080, height: 1920, resize: () => {}, update: () => {}, resource: null } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      sourceRotation: 90,
      transform: { rotationDeg: 45 },
    };

    applier.applySpriteLayout(1080, 1920, clip as any);

    expect(sprite.rotation).toBeCloseTo((135 * Math.PI) / 180);
  });
});
