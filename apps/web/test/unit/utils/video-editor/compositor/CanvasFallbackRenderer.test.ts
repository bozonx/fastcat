import { describe, it, expect, vi } from 'vitest';

import { CanvasFallbackRenderer } from '~/utils/video-editor/compositor/renderers/CanvasFallbackRenderer';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeLayoutApplier() {
  return { applySpriteLayout: vi.fn() } as any;
}

function makeClip(overrides: Partial<CompositorClip> = {}): CompositorClip {
  return {
    itemId: 'clip-1',
    clipKind: 'video',
    sprite: {
      texture: {
        source: {
          width: 2,
          height: 2,
          resize: vi.fn(),
          update: vi.fn(),
        },
      },
    },
    canvas: null,
    ctx: null,
    ...overrides,
  } as unknown as CompositorClip;
}

describe('CanvasFallbackRenderer.ensureCanvasFallback', () => {
  it('creates canvas and ctx when missing', () => {
    const renderer = new CanvasFallbackRenderer({
      width: 1920,
      height: 1080,
      layoutApplier: makeLayoutApplier(),
      clipPreferBitmapFallback: new Map(),
    });
    const clip = makeClip();
    renderer.ensureCanvasFallback(clip);
    expect(clip.canvas).toBeInstanceOf(OffscreenCanvas);
    expect(clip.ctx).not.toBeNull();
    expect(clip.sourceKind).toBe('canvas');
  });

  it('is a no-op when canvas and ctx already exist', () => {
    const renderer = new CanvasFallbackRenderer({
      width: 1920,
      height: 1080,
      layoutApplier: makeLayoutApplier(),
      clipPreferBitmapFallback: new Map(),
    });
    const existingCanvas = new OffscreenCanvas(10, 10);
    const existingCtx = existingCanvas.getContext('2d');
    const clip = makeClip({ canvas: existingCanvas, ctx: existingCtx as any });
    renderer.ensureCanvasFallback(clip);
    // Should not replace existing canvas
    expect(clip.canvas).toBe(existingCanvas);
  });

  it('throws when sprite is null', () => {
    const renderer = new CanvasFallbackRenderer({
      width: 1920,
      height: 1080,
      layoutApplier: makeLayoutApplier(),
      clipPreferBitmapFallback: new Map(),
    });
    const clip = makeClip({ sprite: null });
    expect(() => renderer.ensureCanvasFallback(clip)).toThrow();
  });
});

describe('CanvasFallbackRenderer.drawSampleToCanvas', () => {
  it('returns early when sprite is null', async () => {
    const renderer = new CanvasFallbackRenderer({
      width: 1920,
      height: 1080,
      layoutApplier: makeLayoutApplier(),
      clipPreferBitmapFallback: new Map(),
    });
    const clip = makeClip({ sprite: null });
    await renderer.drawSampleToCanvas({}, clip);
    // Should not throw
  });

  it('draws a sample with toCanvasImageSource', async () => {
    const layoutApplier = makeLayoutApplier();
    const renderer = new CanvasFallbackRenderer({
      width: 1920,
      height: 1080,
      layoutApplier,
      clipPreferBitmapFallback: new Map(),
    });
    const clip = makeClip();
    const mockImageSource = { width: 10, height: 10 };
    const sample = {
      toCanvasImageSource: () => mockImageSource,
    };
    await renderer.drawSampleToCanvas(sample, clip);
    expect(layoutApplier.applySpriteLayout).toHaveBeenCalled();
  });

  it('falls back to sample.draw when drawImage fails', async () => {
    const renderer = new CanvasFallbackRenderer({
      width: 1920,
      height: 1080,
      layoutApplier: makeLayoutApplier(),
      clipPreferBitmapFallback: new Map(),
    });
    const clip = makeClip();
    const drawSpy = vi.fn();
    const sample = {
      toCanvasImageSource: () => {
        throw new Error('Cannot convert');
      },
      draw: drawSpy,
    };
    await renderer.drawSampleToCanvas(sample, clip);
    // After drawImage fails, it should try sample.draw
    expect(drawSpy).toHaveBeenCalled();
  });
});

describe('CanvasFallbackRenderer.drawHudClip', () => {
  it('returns early when clip is not hud', () => {
    const renderer = new CanvasFallbackRenderer({
      width: 1920,
      height: 1080,
      layoutApplier: makeLayoutApplier(),
      clipPreferBitmapFallback: new Map(),
    });
    const clip = makeClip({ clipKind: 'video' });
    expect(() => renderer.drawHudClip(clip, 0)).not.toThrow();
  });

  it('returns early when canvas or ctx is null', () => {
    const renderer = new CanvasFallbackRenderer({
      width: 1920,
      height: 1080,
      layoutApplier: makeLayoutApplier(),
      clipPreferBitmapFallback: new Map(),
    });
    const clip = makeClip({ clipKind: 'hud', canvas: null, ctx: null });
    expect(() => renderer.drawHudClip(clip, 0)).not.toThrow();
  });

  it('returns early when hudType is not media_frame', () => {
    const renderer = new CanvasFallbackRenderer({
      width: 1920,
      height: 1080,
      layoutApplier: makeLayoutApplier(),
      clipPreferBitmapFallback: new Map(),
    });
    const canvas = new OffscreenCanvas(100, 100);
    const clip = makeClip({
      clipKind: 'hud',
      hudType: 'custom' as any,
      canvas,
      ctx: canvas.getContext('2d') as any,
    });
    renderer.drawHudClip(clip, 0);
    // Should not throw — just returns early after clearRect
  });

  it('draws media_frame HUD with background, content, and frame layers', () => {
    const renderer = new CanvasFallbackRenderer({
      width: 320,
      height: 180,
      layoutApplier: makeLayoutApplier(),
      clipPreferBitmapFallback: new Map(),
    });
    const canvas = new OffscreenCanvas(320, 180);
    const ctx = canvas.getContext('2d')!;
    const clip = makeClip({
      clipKind: 'hud',
      hudType: 'media_frame',
      startTicks: 0,
      endTicks: 1_000_000,
      durationTicks: 1_000_000,
      canvas,
      ctx: ctx as any,
      hudMediaStates: {
        background: {
          bitmap: { width: 100, height: 100, close: vi.fn() } as any,
          lastVideoFrame: null,
        },
        content: undefined,
        frame: undefined,
      },
      background: { scaleX: 100, scaleY: 100, offsetX: 0, offsetY: 0 },
    });
    // Should not throw
    renderer.drawHudClip(clip, 100_000);
  });
});
