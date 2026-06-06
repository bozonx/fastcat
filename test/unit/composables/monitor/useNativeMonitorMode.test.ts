import { describe, expect, it } from 'vitest';

import { resolveNativeMonitorCanvasSize } from '~/composables/monitor/useNativeMonitorMode';

describe('resolveNativeMonitorCanvasSize', () => {
  it('uses layout size before monitor workspace transforms', () => {
    expect(
      resolveNativeMonitorCanvasSize({
        layoutWidth: 960,
        layoutHeight: 540,
        dpr: 1,
      }),
    ).toEqual({ width: 960, height: 540 });
  });

  it('caps the render target while preserving aspect ratio', () => {
    expect(
      resolveNativeMonitorCanvasSize({
        layoutWidth: 1920,
        layoutHeight: 1080,
        dpr: 1,
      }),
    ).toEqual({ width: 960, height: 540 });
  });

  it('keeps valid dimensions for hidden or not-yet-laid-out canvas elements', () => {
    expect(
      resolveNativeMonitorCanvasSize({
        layoutWidth: 0,
        layoutHeight: 0,
        dpr: 2,
      }),
    ).toEqual({ width: 1, height: 1 });
  });
});
