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
    // Capture the applied anchor so tests can reconstruct the on-screen origin
    // (top-left) = sprite.x - anchor.x * displayWidth, which is the quantity
    // pixel-grid snapping must land on an integer (not sprite.x itself).
    anchor: {
      x: 0,
      y: 0,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    },
    alpha: 1,
    parent: null,
    mask: null,
    texture: { source: {} },
  } as any;
}

/**
 * On-screen top-left ("origin") of a laid-out sprite. In the non-texture mock path
 * `sprite.width`/`sprite.height` hold the display size and `sprite.scale` is 1 for
 * snap-safe transforms, so the origin is `sprite.pos - anchor * displaySize`. This
 * is what must be integer-aligned for the (already crisp) text canvas bitmap to
 * render 1:1 without resampling.
 */
function spriteOrigin(sprite: any): { x: number; y: number } {
  return {
    x: sprite.x - sprite.anchor.x * sprite.width,
    y: sprite.y - sprite.anchor.y * sprite.height,
  };
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

  // The snapping contract locks the on-screen ORIGIN (top-left) to whole pixels,
  // NOT sprite.x (the anchor position). With a centered anchor and an odd display
  // width, sprite.x is deliberately a half-integer while the origin is an integer —
  // that is exactly what keeps the text canvas bitmap from being resampled. Assert
  // on `spriteOrigin`, never on `sprite.x` directly, or these lock the wrong thing.
  it('lands the on-screen origin on the pixel grid for a repositioned snapped text clip', () => {
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

    const origin = spriteOrigin(sprite);
    expect(Number.isInteger(origin.x)).toBe(true);
    expect(Number.isInteger(origin.y)).toBe(true);
  });

  it('lands the on-screen origin on the pixel grid for a repositioned snapped shape clip', () => {
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

    const origin = spriteOrigin(sprite);
    expect(Number.isInteger(origin.x)).toBe(true);
    expect(Number.isInteger(origin.y)).toBe(true);
  });

  it('rounds the ORIGIN not sprite.x: an odd-width centered text clip keeps a half-integer sprite.x but an integer origin', () => {
    // The regression this whole feature exists to prevent. With an odd display
    // width and a centered (0.5) anchor, the OLD code (`Math.round(sprite.x)`)
    // produced an integer sprite.x but a HALF-INTEGER origin → the crisp text
    // bitmap got resampled = soft edges. The fix rounds the origin instead, which
    // forces sprite.x to a half-integer while the origin lands on a whole pixel.
    const sprite = createMockSprite();
    const mockCtx = {
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    };

    const clip = {
      itemId: 'clip-text-odd-width',
      layer: 1,
      startUs: 0,
      endUs: 1_000_000,
      durationUs: 1_000_000,
      sprite,
      clipKind: 'text' as const,
      clipType: 'text' as const,
      text: 'Odd',
      ctx: mockCtx as any,
      snapToPixelGrid: true,
      transform: { position: { x: 4.3, y: -2.1 } },
      // Explicit odd width (design space, renderScale = 1 at 1920x1080), no padding
      // or border so the background box width is exactly 101 → odd.
      style: {
        fontSize: 40,
        lineHeight: 1.5,
        align: 'left' as const,
        verticalAlign: 'top' as const,
        padding: 0,
        borderEnabled: false,
        width: 101,
      },
    };

    applier.applyTextLayout(clip as any);

    expect(sprite.width % 2).toBe(1); // display width is odd (sanity)
    const origin = spriteOrigin(sprite);
    expect(Number.isInteger(origin.x)).toBe(true);
    // The tell-tale: sprite.x is a half-integer, proving we rounded the origin.
    expect(Number.isInteger(sprite.x)).toBe(false);
  });

  it('leaves the on-screen origin fractional when snapToPixelGrid is false', () => {
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

    expect(Number.isInteger(spriteOrigin(sprite).x)).toBe(false);
  });

  it('leaves the on-screen origin fractional when snapToPixelGrid is true but the clip is rotated', () => {
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

    expect(Number.isInteger(spriteOrigin(sprite).x)).toBe(false);
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

    // Media clips never snap regardless of the flag; the anchor position stays
    // fractional (proves the scoping to text/shape only).
    expect(Number.isInteger(sprite.x)).toBe(false);
  });
});
