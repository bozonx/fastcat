/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Sprite, Texture } from 'pixi.js';
import { TextRenderer } from '~/utils/video-editor/compositor/renderers/TextRenderer';
import { LayoutApplier } from '~/utils/video-editor/compositor/LayoutApplier';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

/**
 * Minimal OffscreenCanvas/2D stand-ins: TextRenderer only needs measureText and
 * no-op draw calls, and Pixi's CanvasSource only reads/writes width/height.
 */
class FakeCtx {
  font = '';
  fillStyle = '';
  strokeStyle = '';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  shadowColor = '';
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  textBaseline = '';
  textAlign = '';
  lineWidth = 0;
  letterSpacing = '0px';
  constructor(public canvas: FakeCanvas) {}
  clearRect() {}
  save() {}
  restore() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  fill() {}
  stroke() {}
  fillText() {}
  strokeText() {}
  measureText(t: string) {
    const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
    const size = m ? Number(m[1]) : 16;
    return { width: t.length * size * 0.5 };
  }
}

class FakeCanvas {
  private ctx: FakeCtx | null = null;
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(kind: string) {
    if (kind !== '2d') return null;
    if (!this.ctx) this.ctx = new FakeCtx(this);
    return this.ctx;
  }
}

const originalOffscreenCanvas = (globalThis as Record<string, unknown>).OffscreenCanvas;

beforeAll(() => {
  (globalThis as Record<string, unknown>).OffscreenCanvas = FakeCanvas;
});

afterAll(() => {
  (globalThis as Record<string, unknown>).OffscreenCanvas = originalOffscreenCanvas;
});

function createTextClip(text: string): CompositorClip {
  const sprite = new Sprite(Texture.EMPTY);
  return {
    itemId: 'text-clip',
    layer: 1,
    startUs: 0,
    endUs: 1_000_000,
    durationUs: 1_000_000,
    sourceStartUs: 0,
    sourceRangeDurationUs: 1_000_000,
    sourceDurationUs: 1_000_000,
    sprite,
    clipKind: 'text',
    clipType: 'text',
    sourceKind: 'canvas',
    canvas: null,
    ctx: null,
    bitmap: null,
    lastVideoFrame: null,
    text,
    style: { fontSize: 64, lineHeight: 1.2 },
  } as unknown as CompositorClip;
}

describe('TextRenderer + LayoutApplier integration', () => {
  const W = 1920;
  const H = 1080;

  it('creates a dynamic texture so the sprite tracks canvas resizes', () => {
    const renderer = new TextRenderer({ designWidth: W, designHeight: H });
    const clip = createTextClip('Text');

    renderer.draw(clip, W, H);

    // Regression guard: without `dynamic`, Pixi Sprites never subscribe to
    // texture updates, so growing the text canvas (more lines / line-height)
    // left the quad at the old size and squashed the rendered text.
    expect(clip.sprite!.texture.dynamic).toBe(true);
  });

  it('keeps sprite scale 1:1 after the text grows from one line to seven', () => {
    const applier = new LayoutApplier({ width: W, height: H });
    const renderer = new TextRenderer({ designWidth: W, designHeight: H });
    const clip = createTextClip('Text');
    const sprite = clip.sprite!;

    // Initial draw + layout (drawTextClip order).
    renderer.draw(clip, W, H);
    applier.applyTextLayout(clip);
    const singleLineHeight = sprite.texture.orig.height;
    expect(sprite.scale.y).toBeCloseTo(1, 3);

    // Text change: the update path applies layout first (texture still stale),
    // then the render tick redraws and re-applies layout.
    clip.text = Array(7).fill('Text').join('\n');
    applier.applyTextLayout(clip);
    renderer.draw(clip, W, H);
    applier.applyTextLayout(clip);

    // 7 lines ≈ 7×lineHeight + padding, comfortably over 3× the 1-line texture.
    expect(sprite.texture.orig.height).toBeGreaterThan(singleLineHeight * 3);
    expect(sprite.scale.x).toBeCloseTo(1, 3);
    expect(sprite.scale.y).toBeCloseTo(1, 3);
  });
});
