import { describe, it, expect } from 'vitest';
import { clampHandlePx, transitionSvgParts } from '../../../../src/utils/timeline/clip';

describe('utils/timeline/clip', () => {
  it('clampHandlePx clamps to clip padding', () => {
    expect(clampHandlePx(0, 100)).toBe(3);
    expect(clampHandlePx(200, 100)).toBe(97);
    expect(clampHandlePx(50, 100)).toBe(50);
  });

  it('transitionSvgParts returns a path for both edges', () => {
    expect(transitionSvgParts(100, 100, 'in')).toContain('L100,50');
    expect(transitionSvgParts(100, 100, 'out')).toContain('M0,0');
  });
});
