import { describe, expect, it } from 'vitest';

import { computeWaveformWindowMetrics, resolveWaveformSourceUs } from '~/utils/audio/waveform';
import { timeUsToPx } from '~/utils/timeline/geometry';

describe('audio waveform utilities', () => {
  it('aligns a trimmed forward clip to the matching source window', () => {
    const zoom = 50;
    const metrics = computeWaveformWindowMetrics({
      sourceStartUs: 2_000_000,
      sourceDurationUs: 10_000_000,
      timelineDurationUs: 3_000_000,
      speed: 1,
      zoom,
    });

    expect(metrics.reversed).toBe(false);
    expect(metrics.leftPx).toBe(-Math.round(timeUsToPx(2_000_000, zoom)));
    expect(metrics.totalWidthPx).toBe(Math.round(timeUsToPx(10_000_000, zoom)));
  });

  it('aligns a reversed clip so the visible window runs from source end to start', () => {
    const zoom = 50;
    const metrics = computeWaveformWindowMetrics({
      sourceStartUs: 2_000_000,
      sourceDurationUs: 10_000_000,
      timelineDurationUs: 3_000_000,
      speed: -1,
      zoom,
    });

    const sourceAtClipLeftPx = metrics.leftPx + metrics.totalWidthPx;
    const sourceAtClipRightPx = sourceAtClipLeftPx - metrics.clipWidthPx;

    expect(metrics.reversed).toBe(true);
    expect(sourceAtClipLeftPx).toBe(Math.round(timeUsToPx(5_000_000, zoom)));
    expect(sourceAtClipRightPx).toBe(Math.round(timeUsToPx(2_000_000, zoom)));
  });

  it('maps nested timeline positive-speed local time with clip speed', () => {
    const sourceUs = resolveWaveformSourceUs({
      absoluteUs: 11_000_000,
      clipStartUs: 10_000_000,
      clipDurationUs: 2_000_000,
      sourceStartUs: 3_000_000,
      sourceRangeDurationUs: 4_000_000,
      speed: 2,
    });

    expect(sourceUs).toBe(5_000_000);
  });

  it('maps nested timeline negative-speed local time from source range end', () => {
    const sourceUs = resolveWaveformSourceUs({
      absoluteUs: 11_000_000,
      clipStartUs: 10_000_000,
      clipDurationUs: 2_000_000,
      sourceStartUs: 3_000_000,
      sourceRangeDurationUs: 4_000_000,
      speed: -2,
    });

    expect(sourceUs).toBe(5_000_000);
  });
});
