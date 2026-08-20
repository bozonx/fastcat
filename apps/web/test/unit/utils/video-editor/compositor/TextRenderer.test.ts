import { describe, it, expect, vi } from 'vitest';

import { TextRenderer } from '~/utils/video-editor/compositor/renderers/TextRenderer';
import type { CompositorClip } from '~/utils/video-editor/compositor/types';

function makeClip(overrides: Partial<CompositorClip> = {}): CompositorClip {
  return {
    itemId: 'clip-1',
    clipKind: 'text',
    text: 'Hello',
    style: {
      fontFamily: 'Arial',
      fontSize: 48,
      fontWeight: '400',
      color: '#ffffff',
      colorAlpha: 1,
      align: 'center',
      verticalAlign: 'middle',
      backgroundEnabled: false,
      borderEnabled: false,
      textShadowEnabled: false,
      padding: 10,
    } as any,
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

describe('TextRenderer.ensureCanvas', () => {
  it('creates canvas and ctx when missing', () => {
    const renderer = new TextRenderer({ designWidth: 1920, designHeight: 1080 });
    const clip = makeClip();
    const result = renderer.ensureCanvas(clip);
    expect(result).toBe(true);
    expect(clip.canvas).toBeInstanceOf(OffscreenCanvas);
    expect(clip.ctx).not.toBeNull();
    expect(clip.sourceKind).toBe('canvas');
  });

  it('returns true when canvas and ctx already exist', () => {
    const renderer = new TextRenderer({ designWidth: 1920, designHeight: 1080 });
    const canvas = new OffscreenCanvas(10, 10);
    const ctx = canvas.getContext('2d');
    const clip = makeClip({ canvas, ctx: ctx as any });
    const result = renderer.ensureCanvas(clip);
    expect(result).toBe(true);
  });
});

describe('TextRenderer.draw', () => {
  it('renders basic text without background, border, or shadow', () => {
    const renderer = new TextRenderer({ designWidth: 1920, designHeight: 1080 });
    const clip = makeClip();
    renderer.draw(clip, 1920, 1080);
    expect(clip.canvas).not.toBeNull();
    // Canvas should have been resized to fit the text
    expect(clip.canvas!.width).toBeGreaterThan(0);
    expect(clip.canvas!.height).toBeGreaterThan(0);
  });

  it('renders text with background enabled', () => {
    const renderer = new TextRenderer({ designWidth: 1920, designHeight: 1080 });
    const clip = makeClip({
      style: {
        ...makeClip().style,
        backgroundEnabled: true,
        backgroundColor: '#000000',
        backgroundAlpha: 0.8,
        backgroundRadius: 10,
        backgroundShadowEnabled: false,
      } as any,
    });
    renderer.draw(clip, 1920, 1080);
    expect(clip.canvas).not.toBeNull();
  });

  it('renders text with text shadow enabled', () => {
    const renderer = new TextRenderer({ designWidth: 1920, designHeight: 1080 });
    const clip = makeClip({
      style: {
        ...makeClip().style,
        textShadowEnabled: true,
        textShadowColor: '#000000',
        textShadowAlpha: 0.5,
        textShadowBlur: 5,
        textShadowSpread: 0,
        textShadowOffsetX: 2,
        textShadowOffsetY: 2,
      } as any,
    });
    renderer.draw(clip, 1920, 1080);
    expect(clip.canvas).not.toBeNull();
  });

  it('renders text with border enabled', () => {
    const renderer = new TextRenderer({ designWidth: 1920, designHeight: 1080 });
    const clip = makeClip({
      style: {
        ...makeClip().style,
        borderEnabled: true,
        borderColor: '#ff0000',
        borderAlpha: 1,
        borderWidth: 2,
        backgroundEnabled: true,
        backgroundColor: '#000000',
        backgroundAlpha: 1,
        backgroundRadius: 5,
        backgroundShadowEnabled: false,
      } as any,
    });
    renderer.draw(clip, 1920, 1080);
    expect(clip.canvas).not.toBeNull();
  });

  it('renders empty text without errors', () => {
    const renderer = new TextRenderer({ designWidth: 1920, designHeight: 1080 });
    const clip = makeClip({ text: '' });
    renderer.draw(clip, 1920, 1080);
    expect(clip.canvas).not.toBeNull();
  });

  it('grows the text canvas for multiline content without reducing font size', () => {
    const renderer = new TextRenderer({ designWidth: 1920, designHeight: 1080 });
    const clip = makeClip({
      text: 'Test',
      style: {
        ...makeClip().style,
        fontSize: 64,
        lineHeight: 1.2,
        padding: 0,
      } as any,
    });

    renderer.draw(clip, 1920, 1080);
    const singleLineHeight = clip.canvas!.height;
    const singleLineFont = clip.ctx!.font;

    clip.text = 'Test\nTest\nTest\nTest\nTest';
    renderer.draw(clip, 1920, 1080);

    expect(clip.canvas!.height).toBeGreaterThan(singleLineHeight);
    expect(clip.ctx!.font).toBe(singleLineFont);
  });

  it('renders with letterSpacing > 0', () => {
    const renderer = new TextRenderer({ designWidth: 1920, designHeight: 1080 });
    const clip = makeClip({
      text: 'Spaced Text',
      style: {
        ...makeClip().style,
        letterSpacing: 5,
      } as any,
    });
    renderer.draw(clip, 1920, 1080);
    expect(clip.canvas).not.toBeNull();
  });

  it('renders with right alignment', () => {
    const renderer = new TextRenderer({ designWidth: 1920, designHeight: 1080 });
    const clip = makeClip({
      text: 'Right text',
      style: {
        ...makeClip().style,
        align: 'right',
      } as any,
    });
    renderer.draw(clip, 1920, 1080);
    expect(clip.canvas).not.toBeNull();
  });

  it('uses default design dimensions when not provided', () => {
    const renderer = new TextRenderer();
    const clip = makeClip();
    renderer.draw(clip, 1920, 1080);
    expect(clip.canvas).not.toBeNull();
  });
});
