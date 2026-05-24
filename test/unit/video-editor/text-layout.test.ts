/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { computeTextLayoutMetrics, normalizeTextClipStyle, getFontStack } from '~/utils/video-editor/text-layout';

describe('text-layout', () => {
  it('normalizes default text style values', () => {
    const style = normalizeTextClipStyle();

    expect(style.fontFamily).toBe('sans-serif');
    expect(style.height).toBeUndefined();
    expect(style.fontSize).toBe(64);
    expect(style.fontWeight).toBe('700');
    expect(style.align).toBe('center');
    expect(style.verticalAlign).toBe('middle');
    expect(style.colorAlpha).toBe(1);
    expect(style.backgroundEnabled).toBe(false);
    expect(style.backgroundAlpha).toBe(1);
    expect(style.backgroundRadius).toBe(0);
    expect(style.textShadowEnabled).toBe(false);
    expect(style.textShadowAlpha).toBe(1);
    expect(style.textShadowBlur).toBe(0);
    expect(style.textShadowSpread).toBe(0);
    expect(style.backgroundShadowEnabled).toBe(false);
    expect(style.backgroundShadowAlpha).toBe(1);
    expect(style.backgroundShadowBlur).toBe(0);
    expect(style.backgroundShadowSpread).toBe(0);
    expect(style.borderEnabled).toBe(false);
    expect(style.borderAlpha).toBe(1);
    expect(style.borderWidth).toBe(0);
    expect(style.padding).toEqual({ top: 60, right: 60, bottom: 60, left: 60 });
  });

  it('links padding by default using horizontal padding for every side', () => {
    const style = normalizeTextClipStyle({ padding: { x: 12, y: 30 } });

    expect(style.padding).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });
  });

  it('wraps text when explicit width is provided', () => {
    const metrics = computeTextLayoutMetrics({
      text: 'one two three four',
      style: {
        width: 220,
        fontSize: 64,
        padding: 10,
        align: 'left',
        verticalAlign: 'top',
      },
      canvasWidth: 1920,
      canvasHeight: 1080,
      measureText: (text) => text.length * 32,
    });

    expect(metrics.explicitWidthPx).toBe(220);
    expect(metrics.contentWidthPx).toBe(200);
    expect(metrics.lines.length).toBeGreaterThan(1);
    expect(metrics.backgroundWidth).toBe(220);
    expect(metrics.backgroundHeight).toBeGreaterThan(metrics.lineHeightPx);
  });

  it('uses measured longest line width when explicit width is not set', () => {
    const metrics = computeTextLayoutMetrics({
      text: 'short\nlonger line',
      style: {
        fontSize: 40,
        padding: { x: 20, y: 10 },
        paddingLinked: false,
        align: 'left',
        verticalAlign: 'top',
      },
      canvasWidth: 1920,
      canvasHeight: 1080,
      measureText: (text) => text.length * 10,
    });

    expect(metrics.explicitWidthPx).toBeUndefined();
    expect(metrics.maxLineWidthPx).toBe(110);
    expect(metrics.textBlockWidthPx).toBe(110);
    expect(metrics.backgroundWidth).toBe(150);
    expect(metrics.backgroundX).toBe(885);
    expect(metrics.backgroundY).toBe(482);
  });

  it('expands text frame metrics for an outer border', () => {
    const metrics = computeTextLayoutMetrics({
      text: 'text',
      style: {
        fontSize: 40,
        padding: 10,
        borderEnabled: true,
        borderWidth: 4,
        verticalAlign: 'top',
        align: 'left',
      },
      canvasWidth: 1920,
      canvasHeight: 1080,
      measureText: (text) => text.length * 10,
    });

    expect(metrics.backgroundX).toBe(926);
    expect(metrics.backgroundY).toBe(502);
    expect(metrics.backgroundWidth).toBe(68);
    expect(metrics.backgroundHeight).toBe(76);
    expect(metrics.textStartX).toBe(940);
  });

  it('uses manual height and vertical alignment inside the text frame', () => {
    const metrics = computeTextLayoutMetrics({
      text: 'text',
      style: {
        fontSize: 40,
        height: 200,
        padding: { x: 10, y: 20 },
        paddingLinked: false,
        verticalAlign: 'bottom',
        align: 'left',
      },
      canvasWidth: 1920,
      canvasHeight: 1080,
      measureText: (text) => text.length * 10,
    });

    expect(metrics.frameHeight).toBe(200);
    expect(metrics.backgroundHeight).toBe(200);
    expect(metrics.textBlockTopPx).toBe(572);
  });

  describe('getFontStack', () => {
    it('returns custom or mapped stack with quotes and fallbacks', () => {
      expect(getFontStack('Arial Black')).toBe('"Arial Black", "Arial Bold", sans-serif');
      expect(getFontStack('Impact')).toBe('Impact, Charcoal, "Arial Narrow Bold", sans-serif');
      expect(getFontStack('Playfair Display')).toBe('"Playfair Display", serif');
      expect(getFontStack('Arial')).toBe('Arial, sans-serif');
      expect(getFontStack('Times New Roman')).toBe('"Times New Roman", Times, serif');
      expect(getFontStack('sans-serif')).toBe('sans-serif');
    });

    it('handles custom fonts with spaces by adding quotes and sans-serif fallback', () => {
      expect(getFontStack('My Awesome Font')).toBe('"My Awesome Font", sans-serif');
      expect(getFontStack('SimpleFont')).toBe('SimpleFont, sans-serif');
    });

    it('keeps already formatted font stacks as is', () => {
      expect(getFontStack('"Custom Font", monospace')).toBe('"Custom Font", monospace');
    });

    it('normalizes fontFamily in style', () => {
      const style = normalizeTextClipStyle({ fontFamily: 'Arial Black' });
      expect(style.fontFamily).toBe('"Arial Black", "Arial Bold", sans-serif');
    });
  });
});
