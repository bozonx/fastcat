import { describe, it, expect } from 'vitest';
import { clampHandlePx } from '~/utils/timeline/clip';

describe('utils/timeline/clip', () => {
  it('clampHandlePx clamps to clip padding', () => {
    expect(clampHandlePx(0, 100)).toBe(3);
    expect(clampHandlePx(200, 100)).toBe(97);
    expect(clampHandlePx(50, 100)).toBe(50);
  });
});
