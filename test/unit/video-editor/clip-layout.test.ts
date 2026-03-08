import { describe, expect, it } from 'vitest';
import {
  computeClipBoxLayout,
  resolveNormalizedAnchor,
} from '../../../src/utils/video-editor/clip-layout';

describe('clip-layout', () => {
  it('resolves preset anchors', () => {
    expect(resolveNormalizedAnchor({ preset: 'center' })).toEqual({ x: 0.5, y: 0.5 });
    expect(resolveNormalizedAnchor({ preset: 'topLeft' })).toEqual({ x: 0, y: 0 });
    expect(resolveNormalizedAnchor({ preset: 'bottomRight' })).toEqual({ x: 1, y: 1 });
  });

  it('converts transform position from design space into render space', () => {
    const layout = computeClipBoxLayout({
      frameWidth: 1920,
      frameHeight: 1080,
      canvasWidth: 960,
      canvasHeight: 540,
      transform: {
        position: { x: 200, y: -100 },
        anchor: { preset: 'center' },
      },
    });

    expect(layout.stagePositionX).toBe(100);
    expect(layout.stagePositionY).toBe(-50);
    expect(layout.anchorOffsetX).toBe(480);
    expect(layout.anchorOffsetY).toBe(270);
  });

  it('fits non-native media into the render canvas before applying transforms', () => {
    const layout = computeClipBoxLayout({
      frameWidth: 1080,
      frameHeight: 1920,
      canvasWidth: 1920,
      canvasHeight: 1080,
      transform: {
        scale: { x: 1.5, y: 0.75 },
        rotationDeg: 15,
        anchor: { preset: 'custom', x: 0.25, y: 0.75 },
      },
    });

    expect(layout.targetWidth).toBeCloseTo(607.5);
    expect(layout.targetHeight).toBe(1080);
    expect(layout.baseX).toBeCloseTo(656.25);
    expect(layout.baseY).toBe(0);
    expect(layout.anchorX).toBe(0.25);
    expect(layout.anchorY).toBe(0.75);
    expect(layout.scaleX).toBe(1.5);
    expect(layout.scaleY).toBe(0.75);
    expect(layout.rotationDeg).toBe(15);
  });
});
