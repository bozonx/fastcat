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

  it('fits a 90 degree rotated source by its rotated bounds', () => {
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
      imageSource: {
        width: 1920,
        height: 1080,
        resize: () => {},
        update: () => {},
        resource: null,
      } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      sourceRotation: 90,
    };

    applier.applySpriteLayout(1920, 1080, clip as any);

    expect(sprite.width).toBeCloseTo(1080);
    expect(sprite.height).toBeCloseTo(607.5);
    expect(sprite.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('fits a 270 degree rotated source by its rotated bounds', () => {
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
      imageSource: {
        width: 1920,
        height: 1080,
        resize: () => {},
        update: () => {},
        resource: null,
      } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      sourceRotation: 270,
    };

    applier.applySpriteLayout(1920, 1080, clip as any);

    expect(sprite.width).toBeCloseTo(1080);
    expect(sprite.height).toBeCloseTo(607.5);
    expect(sprite.rotation).toBeCloseTo(Math.PI * 1.5);
  });

  it('fills a vertical timeline when the first phone video is stored landscape with rotation metadata', () => {
    const verticalApplier = new LayoutApplier({ width: 1080, height: 1920 });
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-vertical',
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
      imageSource: {
        width: 1920,
        height: 1080,
        resize: () => {},
        update: () => {},
        resource: null,
      } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      sourceRotation: 90,
    };

    verticalApplier.applySpriteLayout(1920, 1080, clip as any);

    expect(sprite.width).toBeCloseTo(1920);
    expect(sprite.height).toBeCloseTo(1080);
    expect(sprite.rotation).toBeCloseTo(Math.PI / 2);
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
      imageSource: {
        width: 1920,
        height: 1080,
        resize: () => {},
        update: () => {},
        resource: null,
      } as any,
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
      imageSource: {
        width: 1920,
        height: 1080,
        resize: () => {},
        update: () => {},
        resource: null,
      } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      sourceRotation: 90,
      transform: { rotationDeg: 45 },
    };

    applier.applySpriteLayout(1920, 1080, clip as any);

    expect(sprite.rotation).toBeCloseTo((135 * Math.PI) / 180);
  });

  it('lets sourceOrientation override metadata rotation', () => {
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-5',
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
      imageSource: {
        width: 1920,
        height: 1080,
        resize: () => {},
        update: () => {},
        resource: null,
      } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      sourceRotation: 90,
      sourceOrientation: '0',
    };

    applier.applySpriteLayout(1920, 1080, clip as any);

    expect(sprite.rotation).toBeCloseTo(0);
  });

  it('ignores clip transform and source rotation for blur-fill (native parity)', () => {
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-blur-fill',
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
      imageSource: {
        width: 1920,
        height: 1080,
        resize: () => {},
        update: () => {},
        resource: null,
      } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      // All of these must be ignored when the layer fills the frame.
      sourceRotation: 90,
      transform: { rotationDeg: 45, scale: { x: 2, y: 3 }, position: { x: 200, y: 100 } },
    };

    applier.applySpriteLayout(1920, 1080, clip as any, { ignoreClipTransform: true });

    // Frame-sized result maps 1:1 onto the frame: no swap, no scale, no rotation.
    expect(sprite.width).toBeCloseTo(1920);
    expect(sprite.height).toBeCloseTo(1080);
    expect(sprite.scale.x).toBeCloseTo(1);
    expect(sprite.scale.y).toBeCloseTo(1);
    expect(sprite.rotation).toBeCloseTo(0);
    // Centered on the canvas (centre anchor), unaffected by transform.position.
    expect(sprite.x).toBeCloseTo(960);
    expect(sprite.y).toBeCloseTo(540);
  });

  it('applies text layout correctly to text clips', () => {
    const sprite = createMockSprite();
    const mockCtx = {
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    };

    const clip = {
      itemId: 'clip-text',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sprite,
      clipKind: 'text' as const,
      clipType: 'text' as const,
      text: 'Sample Text',
      ctx: mockCtx as any,
      style: {
        fontSize: 40,
        lineHeight: 1.5,
        align: 'center' as const,
        verticalAlign: 'middle' as const,
        padding: 10,
      },
    };

    applier.applyTextLayout(clip as any);

    // Text box height should be (lines.length * lineHeight + padding * 2) * renderScale
    // With renderScale = 1 (canvasHeight = 1080, DESIGN_BASE = 1080)
    // fontSize = 40, lineHeight = 1.5 -> lineHeightPx = 60
    // padding = 10 -> paddingPx = 10
    // height = 60 + 20 = 80
    expect(sprite.width).toBeCloseTo(130); // 110 + 20
    expect(sprite.height).toBeCloseTo(80);
    expect(sprite.x).toBeCloseTo(1920 / 2); // Centered because of align and center anchor
    expect(sprite.y).toBeCloseTo(1080 / 2);
  });

  it('applies transform scale magnitude to text clips', () => {
    const sprite = createMockSprite();
    const mockCtx = {
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    };

    const clip = {
      itemId: 'clip-text-scaled',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sprite,
      clipKind: 'text' as const,
      clipType: 'text' as const,
      text: 'Sample Text',
      ctx: mockCtx as any,
      transform: { scale: { x: 2, y: 0.5 } },
      style: {
        fontSize: 40,
        lineHeight: 1.5,
        align: 'center' as const,
        verticalAlign: 'middle' as const,
        padding: 10,
      },
    };

    applier.applyTextLayout(clip as any);

    expect(sprite.scale.x).toBeCloseTo(2);
    expect(sprite.scale.y).toBeCloseTo(0.5);
  });

  it('resets stale text sprite scale from the resized texture size', () => {
    const sprite = createMockSprite();
    sprite.scale.x = 0.25;
    sprite.scale.y = 0.25;
    sprite.texture = { orig: { width: 40, height: 240 }, source: {} };
    const mockCtx = {
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    };

    const clip = {
      itemId: 'clip-text-live-resize',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sprite,
      clipKind: 'text' as const,
      clipType: 'text' as const,
      text: 'Test\nTest\nTest\nTest\nTest',
      ctx: mockCtx as any,
      style: {
        fontSize: 40,
        lineHeight: 1.2,
        align: 'left' as const,
        verticalAlign: 'top' as const,
        padding: 0,
      },
    };

    applier.applyTextLayout(clip as any);

    expect(sprite.scale.x).toBeCloseTo(1);
    expect(sprite.scale.y).toBeCloseTo(1);
  });

  it('uses resized imageSource dimensions to compensate blur bleed padding', () => {
    const sprite = createMockSprite();
    sprite.texture = {
      orig: { width: 1920, height: 1080 },
      source: { width: 1920, height: 1080 },
    };
    const clip = {
      itemId: 'clip-blur-bleed',
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
      imageSource: {
        width: 2460,
        height: 1620,
        resize: () => {},
        update: () => {},
        resource: null,
      } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      effectSourceW: 1920,
      effectSourceH: 1080,
    };

    applier.applyClipLayoutForCurrentSource(clip as any);

    expect(sprite.scale.x).toBeCloseTo(2460 / 1920);
    expect(sprite.scale.y).toBeCloseTo(1620 / 1080);
  });

  it('rounds final sprite position for a repositioned snapped text clip', () => {
    const sprite = createMockSprite();
    const mockCtx = {
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    };

    const clip = {
      itemId: 'clip-text-snap-position',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sprite,
      clipKind: 'text' as const,
      clipType: 'text' as const,
      text: 'Sample Text',
      ctx: mockCtx as any,
      snapToPixelGrid: true,
      transform: { position: { x: 13.4, y: -7.6 } },
      style: {
        fontSize: 40,
        lineHeight: 1.5,
        align: 'center' as const,
        verticalAlign: 'middle' as const,
        padding: 10,
      },
    };

    applier.applyTextLayout(clip as any);

    expect(Number.isInteger(sprite.x)).toBe(true);
    expect(Number.isInteger(sprite.y)).toBe(true);
  });

  it('rounds final sprite position for a repositioned snapped shape clip', () => {
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-shape-snap-position',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sprite,
      clipKind: 'shape' as const,
      clipType: 'shape' as const,
      strokeWidth: 3,
      snapToPixelGrid: true,
      transform: { position: { x: 13.4, y: -7.6 } },
    };

    applier.applyShapeLayout(clip as any);

    expect(Number.isInteger(sprite.x)).toBe(true);
    expect(Number.isInteger(sprite.y)).toBe(true);
  });

  it('leaves sprite position fractional when snapToPixelGrid is false', () => {
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-shape-no-snap',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sprite,
      clipKind: 'shape' as const,
      clipType: 'shape' as const,
      strokeWidth: 3,
      snapToPixelGrid: false,
      transform: { position: { x: 13.4, y: -7.6 } },
    };

    applier.applyShapeLayout(clip as any);

    expect(Number.isInteger(sprite.x)).toBe(false);
  });

  it('leaves sprite position fractional when snapToPixelGrid is true but the clip is rotated', () => {
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-shape-snap-rotated',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sprite,
      clipKind: 'shape' as const,
      clipType: 'shape' as const,
      strokeWidth: 3,
      snapToPixelGrid: true,
      transform: { position: { x: 13.4, y: -7.6 }, rotationDeg: 45 },
    };

    applier.applyShapeLayout(clip as any);

    expect(Number.isInteger(sprite.x)).toBe(false);
  });

  it('does not snap video/media clips even when snapToPixelGrid is set', () => {
    const sprite = createMockSprite();
    const clip = {
      itemId: 'clip-video-snap-ignored',
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
      imageSource: {
        width: 1920,
        height: 1080,
        resize: () => {},
        update: () => {},
        resource: null,
      } as any,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      snapToPixelGrid: true,
      transform: { position: { x: 13.4, y: -7.6 } },
    };

    applier.applySpriteLayout(1920, 1080, clip as any);

    expect(Number.isInteger(sprite.x)).toBe(false);
  });
});
