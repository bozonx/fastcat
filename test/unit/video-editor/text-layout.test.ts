/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { computeTextLayoutMetrics, normalizeTextClipStyle } from '~/utils/video-editor/text-layout';

describe('text-layout', () => {
  it('normalizes default text style values', () => {
    const style = normalizeTextClipStyle();

    expect(style.fontFamily).toBe('sans-serif');
    expect(style.fontSize).toBe(64);
    expect(style.fontWeight).toBe('700');
    expect(style.align).toBe('center');
    expect(style.verticalAlign).toBe('middle');
    expect(style.padding).toEqual({ top: 60, right: 60, bottom: 60, left: 60 });
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
    expect(metrics.backgroundX).toBe(0);
    expect(metrics.backgroundY).toBe(0);
  });
});
