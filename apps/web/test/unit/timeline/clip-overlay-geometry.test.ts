/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { computeClipCenteredOverlayLeftPx } from '~/utils/timeline/geometry';

describe('computeClipCenteredOverlayLeftPx', () => {
  it('sits at the clip centre when the whole clip is visible', () => {
    const left = computeClipCenteredOverlayLeftPx({
      clipStartPx: 100,
      clipWidthPx: 400,
      scrollLeft: 0,
      viewportWidth: 1000,
    });
    expect(left).toBe(200); // clipWidthPx / 2
  });

  it('falls back to the clip centre without viewport info', () => {
    const left = computeClipCenteredOverlayLeftPx({
      clipStartPx: 100,
      clipWidthPx: 400,
    });
    expect(left).toBe(200);
  });

  it('follows the scroll to centre on the visible slice when the clip left is off-screen', () => {
    // Clip spans absolute 0..400; viewport shows absolute 100..300.
    const left = computeClipCenteredOverlayLeftPx({
      clipStartPx: 0,
      clipWidthPx: 400,
      scrollLeft: 100,
      viewportWidth: 200,
    });
    // Visible slice centre = (100 + 300) / 2 = 200 absolute → 200 clip-local.
    expect(left).toBe(200);
  });

  it('clamps within the clip minus padding', () => {
    // Visible slice is far to the right of the clip; padding keeps it inside.
    const left = computeClipCenteredOverlayLeftPx({
      clipStartPx: 0,
      clipWidthPx: 100,
      scrollLeft: 90,
      viewportWidth: 500,
      paddingPx: 24,
    });
    // Visible slice = 90..100 → centre 95, but clamped to clipWidth - padding = 76.
    expect(left).toBe(76);
  });

  it('returns the clip centre when the clip is entirely outside the viewport', () => {
    const left = computeClipCenteredOverlayLeftPx({
      clipStartPx: 0,
      clipWidthPx: 100,
      scrollLeft: 500,
      viewportWidth: 200,
    });
    expect(left).toBe(50);
  });
});
