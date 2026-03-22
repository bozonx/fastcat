import { describe, expect, it } from 'vitest';
import {
  computeClipBoxLayout,
  computeCropMaskPolygon,
  resolveNormalizedAnchor,
} from '~/utils/video-editor/clip-layout';

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

describe('computeCropMaskPolygon', () => {
  const base = {
    targetW: 1920,
    targetH: 1080,
    anchorX: 0.5,
    anchorY: 0.5,
    scaleX: 1,
    scaleY: 1,
    rotationRad: 0,
    spritePosX: 960,
    spritePosY: 540,
  };

  it('returns full-media polygon when crop is zero', () => {
    const { points } = computeCropMaskPolygon({ ...base, crop: {} });
    // TL, TR, BR, BL corners in world space (no crop = full 1920×1080)
    expect(points[0]).toBeCloseTo(0); // TL x
    expect(points[1]).toBeCloseTo(0); // TL y
    expect(points[2]).toBeCloseTo(1920); // TR x
    expect(points[3]).toBeCloseTo(0); // TR y
    expect(points[4]).toBeCloseTo(1920); // BR x
    expect(points[5]).toBeCloseTo(1080); // BR y
    expect(points[6]).toBeCloseTo(0); // BL x
    expect(points[7]).toBeCloseTo(1080); // BL y
  });

  it('crops left 10% and top 20% correctly (no rotation)', () => {
    const { points } = computeCropMaskPolygon({
      ...base,
      crop: { left: 10, top: 20 },
    });
    // TL should be at (192, 216) world
    expect(points[0]).toBeCloseTo(192);
    expect(points[1]).toBeCloseTo(216);
    // TR at (1920, 216)
    expect(points[2]).toBeCloseTo(1920);
    expect(points[3]).toBeCloseTo(216);
    // BR at (1920, 1080)
    expect(points[4]).toBeCloseTo(1920);
    expect(points[5]).toBeCloseTo(1080);
    // BL at (192, 1080)
    expect(points[6]).toBeCloseTo(192);
    expect(points[7]).toBeCloseTo(1080);
  });

  it('applies horizontal flip — crop left stays at original-left side of texture', () => {
    const { points } = computeCropMaskPolygon({
      ...base,
      scaleX: -1,
      crop: { left: 10 },
    });
    // With flip, left-edge in display space maps to the right side in world space.
    // left=10% → 192px from display-left; with anchor at center (960), world x:
    // dx = (192 - 960) * (-1) = 768, world_x = 960 + 768 = 1728
    expect(points[0]).toBeCloseTo(1728); // TL x (right side after flip)
    expect(points[2]).toBeCloseTo(0); // TR x (left side after flip)
  });

  it('clamps overlapping opposite edges to prevent degenerate polygon', () => {
    // top=60% + bottom=60% would exceed 100% — bottom is clamped to 40%
    const { points } = computeCropMaskPolygon({
      ...base,
      crop: { top: 60, bottom: 60 },
    });
    const safeCropT = 0.6 * 1080; // 648
    const safeCropB = 1080 - safeCropT; // 432 (clamped)
    expect(points[1]).toBeCloseTo(safeCropT); // TL y
    expect(points[5]).toBeCloseTo(1080 - safeCropB); // BR y == TL y (zero height)
  });

  it('rotates crop polygon correctly by 90 degrees', () => {
    const { points } = computeCropMaskPolygon({
      ...base,
      rotationRad: Math.PI / 2,
      crop: { top: 10 },
    });
    // top=10% = 108px from top in display space.
    // TL corner in display-space: (0, 108). Relative to center anchor: (-960, 108-540)=(-960,-432)
    // After 90° rotation: (dx,dy)→(-dy,dx), so (-960,-432) → (432,-960)
    // world: (960+432, 540-960) = (1392, -420)
    expect(points[0]).toBeCloseTo(1392);
    expect(points[1]).toBeCloseTo(-420);
  });
});
