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
  // Records each text draw with the state in effect, for regression asserts.
  strokeCalls: {
    text: string;
    op: string;
    lineWidth: number;
    shadowOffsetX: number;
    x: number;
    y: number;
  }[] = [];
  fillCalls: { text: string; op: string; shadowOffsetX: number; x: number; y: number }[] = [];
  shapeFillCalls: { op: string; shadowColor: string; shadowBlur: number; shadowOffsetX: number }[] =
    [];
  private stateStack: Record<string, unknown>[] = [];
  private static readonly SAVED_PROPS = [
    'font',
    'fillStyle',
    'strokeStyle',
    'globalAlpha',
    'globalCompositeOperation',
    'shadowColor',
    'shadowBlur',
    'shadowOffsetX',
    'shadowOffsetY',
    'textBaseline',
    'textAlign',
    'lineWidth',
    'letterSpacing',
  ];
  constructor(public canvas: FakeCanvas) {}
  clearRect() {}
  save() {
    const snap: Record<string, unknown> = {};
    for (const p of FakeCtx.SAVED_PROPS) snap[p] = (this as Record<string, unknown>)[p];
    this.stateStack.push(snap);
  }
  restore() {
    const snap = this.stateStack.pop();
    if (!snap) return;
    for (const p of FakeCtx.SAVED_PROPS) (this as Record<string, unknown>)[p] = snap[p];
  }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arcTo() {}
  quadraticCurveTo() {}
  fill() {
    this.shapeFillCalls.push({
      op: this.globalCompositeOperation,
      shadowColor: this.shadowColor,
      shadowBlur: this.shadowBlur,
      shadowOffsetX: this.shadowOffsetX,
    });
  }
  stroke() {}
  fillText(text: string, x: number, y: number) {
    this.fillCalls.push({
      text,
      op: this.globalCompositeOperation,
      shadowOffsetX: this.shadowOffsetX,
      x,
      y,
    });
  }
  strokeText(text: string, x: number, y: number) {
    this.strokeCalls.push({
      text,
      op: this.globalCompositeOperation,
      lineWidth: this.lineWidth,
      shadowOffsetX: this.shadowOffsetX,
      x,
      y,
    });
  }
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
    startTicks: 0,
    endTicks: 1_000_000,
    durationTicks: 1_000_000,
    sourceStartTicks: 0,
    sourceRangeDurationTicks: 1_000_000,
    sourceDurationTicks: 1_000_000,
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

function expectIntegerTextCoords(call: { x: number; y: number }) {
  expect(call.x).toBe(Math.round(call.x));
  expect(call.y).toBe(Math.round(call.y));
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

  it('renders the spread shadow off-canvas so no hard outline is painted on top', () => {
    const renderer = new TextRenderer({ designWidth: W, designHeight: H });
    const clip = createTextClip('Text');
    (clip as unknown as { style: Record<string, unknown> }).style = {
      fontSize: 64,
      lineHeight: 1.2,
      textShadowEnabled: true,
      textShadowColor: '#000000',
      textShadowAlpha: 1,
      textShadowBlur: 10,
      textShadowSpread: 14,
      textShadowOffsetX: 0,
      textShadowOffsetY: 4,
    };

    renderer.draw(clip, W, H);
    const ctx = clip.ctx as unknown as FakeCtx;

    // Spread must dilate the shadow: a stroke pass runs with a positive lineWidth.
    const spreadStroke = ctx.strokeCalls.find((c) => c.lineWidth > 0);
    expect(spreadStroke).toBeDefined();

    // The shadow (fill + spread stroke) must be emitted off-canvas — a large
    // shadowOffset brings only the blurred/dilated shadow into place. Painting on
    // canvas (small offset) would leave the solid glyph/stroke shape visible as a
    // hard black outline around the text.
    const canvasSpan = ctx.canvas.width + ctx.canvas.height;
    expect(spreadStroke!.shadowOffsetX).toBeGreaterThan(canvasSpan);

    // The main white text is drawn on top with NO shadow (offset 0).
    const mainText = ctx.fillCalls.find((c) => c.shadowOffsetX === 0);
    expect(mainText).toBeDefined();

    // No composite trickery is needed anymore; nothing is cut back out.
    expect(ctx.strokeCalls.every((c) => c.op === 'source-over')).toBe(true);
    expect(ctx.fillCalls.every((c) => c.op === 'source-over')).toBe(true);
  });

  it('snaps actual text draw coordinates when pixel-grid snapping is enabled', () => {
    const renderer = new TextRenderer({ designWidth: W, designHeight: H });
    const clip = createTextClip('Text');
    clip.snapToPixelGrid = true;
    (clip as unknown as { style: Record<string, unknown> }).style = {
      fontSize: 31,
      lineHeight: 1.3,
      padding: 7,
      align: 'center',
    };

    renderer.draw(clip, W, H);
    const ctx = clip.ctx as unknown as FakeCtx;
    const mainText = ctx.fillCalls.find((c) => c.shadowOffsetX === 0);

    expect(mainText).toBeDefined();
    expectIntegerTextCoords(mainText!);
  });

  it('snaps shadow spread text draw coordinates when pixel-grid snapping is enabled', () => {
    const renderer = new TextRenderer({ designWidth: W, designHeight: H });
    const clip = createTextClip('Text');
    clip.snapToPixelGrid = true;
    (clip as unknown as { style: Record<string, unknown> }).style = {
      fontSize: 31,
      lineHeight: 1.3,
      padding: 7,
      align: 'center',
      textShadowEnabled: true,
      textShadowColor: '#000000',
      textShadowAlpha: 1,
      textShadowBlur: 6,
      textShadowSpread: 5,
      textShadowOffsetX: 1,
      textShadowOffsetY: 1,
    };

    renderer.draw(clip, W, H);
    const ctx = clip.ctx as unknown as FakeCtx;
    const spreadStroke = ctx.strokeCalls.find((c) => c.lineWidth > 0);
    const shadowFill = ctx.fillCalls.find((c) => c.shadowOffsetX > ctx.canvas.width);
    const mainText = ctx.fillCalls.find((c) => c.shadowOffsetX === 0);

    expect(spreadStroke).toBeDefined();
    expect(shadowFill).toBeDefined();
    expect(mainText).toBeDefined();
    expectIntegerTextCoords(spreadStroke!);
    expectIntegerTextCoords(shadowFill!);
    expectIntegerTextCoords(mainText!);
  });

  it('snaps native letterSpacing text draw coordinates when pixel-grid snapping is enabled', () => {
    const renderer = new TextRenderer({ designWidth: W, designHeight: H });
    const clip = createTextClip('Text');
    clip.snapToPixelGrid = true;
    (clip as unknown as { style: Record<string, unknown> }).style = {
      fontSize: 31,
      lineHeight: 1.3,
      padding: 7,
      align: 'center',
      letterSpacing: 3,
    };

    renderer.draw(clip, W, H);
    const ctx = clip.ctx as unknown as FakeCtx;
    const mainText = ctx.fillCalls.find((c) => c.text === 'Text' && c.shadowOffsetX === 0);

    expect(mainText).toBeDefined();
    expectIntegerTextCoords(mainText!);
  });

  it('keeps fractional text draw coordinates when pixel-grid snapping is disabled', () => {
    const renderer = new TextRenderer({ designWidth: W, designHeight: H });
    const clip = createTextClip('Text');
    clip.snapToPixelGrid = false;
    (clip as unknown as { style: Record<string, unknown> }).style = {
      fontSize: 31,
      lineHeight: 1.3,
      padding: 7,
      align: 'center',
    };

    renderer.draw(clip, W, H);
    const ctx = clip.ctx as unknown as FakeCtx;
    const mainText = ctx.fillCalls.find((c) => c.shadowOffsetX === 0);

    expect(mainText).toBeDefined();
    expect(mainText!.y).not.toBe(Math.round(mainText!.y));
  });

  it('keeps one combined background shadow while border offset is below two pixels', () => {
    const renderer = new TextRenderer({ designWidth: W, designHeight: H });
    const clip = createTextClip('Text');
    (clip as unknown as { style: Record<string, unknown> }).style = {
      fontSize: 64,
      lineHeight: 1.2,
      backgroundEnabled: true,
      backgroundColor: '#ffffff',
      backgroundShadowEnabled: true,
      backgroundShadowColor: '#000000',
      backgroundShadowAlpha: 1,
      backgroundShadowBlur: 8,
      backgroundShadowSpread: 2,
      borderEnabled: true,
      borderWidth: 4,
      borderOffset: 1,
    };

    renderer.draw(clip, W, H);
    const ctx = clip.ctx as unknown as FakeCtx;
    const shadowFills = ctx.shapeFillCalls.filter(
      (c) => c.op === 'source-over' && c.shadowBlur > 0,
    );

    expect(shadowFills).toHaveLength(1);
  });

  it('renders a separate border shadow when border offset reaches two pixels', () => {
    const renderer = new TextRenderer({ designWidth: W, designHeight: H });
    const clip = createTextClip('Text');
    (clip as unknown as { style: Record<string, unknown> }).style = {
      fontSize: 64,
      lineHeight: 1.2,
      backgroundEnabled: true,
      backgroundColor: '#ffffff',
      backgroundShadowEnabled: true,
      backgroundShadowColor: '#000000',
      backgroundShadowAlpha: 1,
      backgroundShadowBlur: 8,
      backgroundShadowSpread: 2,
      borderEnabled: true,
      borderWidth: 4,
      borderOffset: 2,
    };

    renderer.draw(clip, W, H);
    const ctx = clip.ctx as unknown as FakeCtx;
    const shadowFills = ctx.shapeFillCalls.filter(
      (c) => c.op === 'source-over' && c.shadowBlur > 0,
    );

    expect(shadowFills).toHaveLength(2);
  });
});
