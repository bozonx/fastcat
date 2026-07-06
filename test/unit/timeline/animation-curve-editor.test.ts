/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  buildCurvePolyline,
  curveYToValue,
  resolveCurveValueRange,
  valueToCurveY,
} from '~/timeline/animation/curve-editor';
import type { KeyframeTrack } from '~/timeline/types';

describe('animation curve editor geometry', () => {
  const track: KeyframeTrack = {
    keyframes: [
      { tUs: 0, value: 0, easing: 'linear' },
      { tUs: 100, value: 1, easing: 'linear' },
    ],
  };

  it('resolves a padded range for flat tracks', () => {
    expect(resolveCurveValueRange({ keyframes: [{ tUs: 0, value: 5, easing: 'linear' }] })).toEqual(
      { min: 4, max: 6 },
    );
  });

  it('maps values to y coordinates and back', () => {
    const range = resolveCurveValueRange(track);
    const y = valueToCurveY({ value: 0.25, range, heightPx: 100, paddingPx: 10 });
    expect(curveYToValue({ y, range, heightPx: 100, paddingPx: 10 })).toBeCloseTo(0.25);
  });

  it('samples one point per pixel across the curve width', () => {
    const points = buildCurvePolyline({
      track,
      durationUs: 100,
      widthPx: 4,
      heightPx: 100,
      paddingPx: 10,
    });
    expect(points).toHaveLength(5);
    expect(points[0]).toEqual({ x: 0, y: 90 });
    expect(points[4]).toEqual({ x: 4, y: 10 });
  });
});
