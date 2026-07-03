import { describe, it, expect, vi } from 'vitest';

import { ShapeRenderer } from '~/utils/video-editor/compositor/renderers/ShapeRenderer';

function createMockGraphics() {
  const calls: string[] = [];
  return {
    calls,
    clear: vi.fn(() => calls.push('clear')),
    rect: vi.fn((...args: number[]) => calls.push('rect')),
    roundRect: vi.fn((...args: unknown[]) => calls.push('roundRect')),
    ellipse: vi.fn((...args: number[]) => calls.push('ellipse')),
    circle: vi.fn((...args: number[]) => calls.push('circle')),
    moveTo: vi.fn((...args: number[]) => calls.push('moveTo')),
    lineTo: vi.fn((...args: number[]) => calls.push('lineTo')),
    closePath: vi.fn(() => calls.push('closePath')),
    quadraticCurveTo: vi.fn((...args: number[]) => calls.push('quadraticCurveTo')),
    fill: vi.fn(() => calls.push('fill')),
    stroke: vi.fn(() => calls.push('stroke')),
  };
}

describe('ShapeRenderer.computeLayout', () => {
  it('computes centered layout with scaled stroke', () => {
    const renderer = new ShapeRenderer();
    const layout = renderer.computeLayout({
      canvasWidth: 1920,
      canvasHeight: 1080,
      strokeWidth: 10,
    });
    // size = min(1920, 1080) * 0.8 = 864
    // scaledStroke = 10 * min(1920/1920, 1080/1080) = 10
    // targetW = ceil(864 + 20) = 884
    expect(layout.targetW).toBe(884);
    expect(layout.targetH).toBe(884);
    expect(layout.baseX).toBe((1920 - 884) / 2);
    expect(layout.baseY).toBe((1080 - 884) / 2);
  });

  it('handles zero stroke width', () => {
    const renderer = new ShapeRenderer();
    const layout = renderer.computeLayout({
      canvasWidth: 1000,
      canvasHeight: 500,
      strokeWidth: 0,
    });
    // size = 500 * 0.8 = 400, no stroke addition
    expect(layout.targetW).toBe(400);
    expect(layout.targetH).toBe(400);
  });
});

describe('ShapeRenderer.draw', () => {
  it('draws a square with default config', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'square',
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      config: {},
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(g.clear).toHaveBeenCalled();
    expect(g.rect).toHaveBeenCalled();
    expect(g.fill).toHaveBeenCalled();
  });

  it('draws a rounded square when cornerRadius > 0', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'square',
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      config: { width: 100, height: 100, cornerRadius: 20 },
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(g.roundRect).toHaveBeenCalled();
  });

  it('draws a circle with squash', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'circle',
      fill: '#00ff00',
      stroke: '#000000',
      strokeWidth: 0,
      config: { squashX: 20, squashY: 10 },
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(g.ellipse).toHaveBeenCalled();
  });

  it('draws a triangle', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'triangle',
      fill: '#0000ff',
      stroke: '#000000',
      strokeWidth: 0,
      config: { baseLength: 100, vertexOffset: 50 },
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(g.moveTo).toHaveBeenCalled();
    expect(g.lineTo).toHaveBeenCalled();
    expect(g.closePath).toHaveBeenCalled();
  });

  it('draws a star', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'star',
      fill: '#ffff00',
      stroke: '#000000',
      strokeWidth: 0,
      config: { rays: 5, innerRadius: 40 },
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(g.moveTo).toHaveBeenCalled();
    expect(g.lineTo).toHaveBeenCalled();
    expect(g.closePath).toHaveBeenCalled();
  });

  it('draws a cloud type 1', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'cloud',
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 0,
      config: { cloudType: 1 },
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(g.circle).toHaveBeenCalledTimes(4);
  });

  it('draws a cloud type 2', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'cloud',
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 0,
      config: { cloudType: 2 },
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(g.circle).toHaveBeenCalledTimes(5);
  });

  it('draws a speech bubble', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'speech_bubble',
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 0,
      config: { width: 100, height: 70, cornerRadius: 20, pointerDirection: 'left' },
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(g.moveTo).toHaveBeenCalled();
    expect(g.quadraticCurveTo).toHaveBeenCalled();
  });

  it('falls back to square for unknown type', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'unknown' as any,
      fill: '#ffffff',
      stroke: '#000000',
      strokeWidth: 0,
      config: {},
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(g.rect).toHaveBeenCalled();
  });

  it('applies stroke when strokeWidth > 0', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'square',
      fill: '#ffffff',
      stroke: '#ff0000',
      strokeWidth: 5,
      config: {},
      canvasWidth: 1920,
      canvasHeight: 1080,
    });
    expect(g.stroke).toHaveBeenCalled();
  });
});

describe('ShapeRenderer.draw pixel-grid snapping', () => {
  // canvasWidth/Height chosen so the unsnapped `size` (min * 0.8 = 865.6) is
  // fractional but rounds to an EVEN integer (866), keeping `cy`/`cx` whole and
  // isolating the assertions below to the `half` derivation fix.
  const canvasWidth = 2000;
  const canvasHeight = 1082;

  it('derives an integer circle radius from the snapped bounding box', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'circle',
      fill: '#00ff00',
      stroke: '#000000',
      strokeWidth: 0,
      config: {},
      canvasWidth,
      canvasHeight,
      snapToPixelGrid: true,
    });
    const [, , rx, ry] = g.ellipse.mock.calls[0] as number[];
    expect(Number.isInteger(rx)).toBe(true);
    expect(Number.isInteger(ry)).toBe(true);
  });

  it('leaves circle radius fractional when snapToPixelGrid is false', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'circle',
      fill: '#00ff00',
      stroke: '#000000',
      strokeWidth: 0,
      config: {},
      canvasWidth,
      canvasHeight,
      snapToPixelGrid: false,
    });
    const [, , rx] = g.ellipse.mock.calls[0] as number[];
    expect(Number.isInteger(rx)).toBe(false);
  });

  it('leaves circle radius fractional when the transform is rotated', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'circle',
      fill: '#00ff00',
      stroke: '#000000',
      strokeWidth: 0,
      config: {},
      canvasWidth,
      canvasHeight,
      snapToPixelGrid: true,
      transform: { rotationDeg: 45 },
    });
    const [, , rx] = g.ellipse.mock.calls[0] as number[];
    expect(Number.isInteger(rx)).toBe(false);
  });

  it('derives an integer triangle apex offset from the snapped bounding box', () => {
    const renderer = new ShapeRenderer();
    const g = createMockGraphics();
    renderer.draw({
      graphics: g as any,
      type: 'triangle',
      fill: '#0000ff',
      stroke: '#000000',
      strokeWidth: 0,
      config: { baseLength: 100, vertexOffset: 50 },
      canvasWidth,
      canvasHeight,
      snapToPixelGrid: true,
    });
    // Triangle top/bottom Y are `cy -/+ half` — both integer once `half` is
    // snapped, given the canvas size above keeps `cy` a whole number too.
    const [, topY] = g.moveTo.mock.calls[0] as number[];
    const [, bottomY] = g.lineTo.mock.calls[0] as number[];
    expect(Number.isInteger(topY)).toBe(true);
    expect(Number.isInteger(bottomY)).toBe(true);
  });
});
