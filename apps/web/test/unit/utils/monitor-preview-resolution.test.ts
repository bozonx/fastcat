import { describe, expect, it } from 'vitest';
import { resolveMonitorPreviewSize } from '~/utils/monitor-preview-resolution';

describe('resolveMonitorPreviewSize', () => {
  it('uses the exact scene scale selected by the user', () => {
    expect(
      resolveMonitorPreviewSize({
        sceneWidth: 3840,
        sceneHeight: 2160,
        viewportWidth: 320,
        viewportHeight: 180,
        manualScale: 0.5,
      }),
    ).toEqual({ width: 1920, height: 1080, scale: 0.5 });
  });

  it('caps auto resolution by the physical viewport and shared long-edge ceiling', () => {
    expect(
      resolveMonitorPreviewSize({
        sceneWidth: 3840,
        sceneHeight: 2160,
        viewportWidth: 640,
        viewportHeight: 360,
        devicePixelRatio: 2,
      }),
    ).toEqual({ width: 960, height: 540, scale: 0.25 });
  });
});
