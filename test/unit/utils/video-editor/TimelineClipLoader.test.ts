/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { TimelineClipLoader } from '~/utils/video-editor/compositor/TimelineClipLoader';

describe('TimelineClipLoader', () => {
  it('does not treat sourceRange duration as full source duration', () => {
    const loader = new TimelineClipLoader();
    const descriptor = loader.describe({
      index: 0,
      sequentialTimeTicks: 0,
      clipData: {
        kind: 'clip',
        id: 'clip-1',
        clipType: 'media',
        source: { path: 'video.mp4' },
        timelineRange: { startTicks: 0, durationTicks: 2_000_000 },
        sourceRange: { startTicks: 5_000_000, durationTicks: 2_000_000 },
      },
    });

    expect(descriptor?.requestedSourceDurationTicks).toBe(0);
    expect(descriptor?.requestedSourceRangeDurationTicks).toBe(2_000_000);
  });

  it('preserves explicit sourceDurationTicks when available', () => {
    const loader = new TimelineClipLoader();
    const descriptor = loader.describe({
      index: 0,
      sequentialTimeTicks: 0,
      clipData: {
        kind: 'clip',
        id: 'clip-1',
        clipType: 'media',
        source: { path: 'video.mp4' },
        timelineRange: { startTicks: 0, durationTicks: 2_000_000 },
        sourceRange: { startTicks: 5_000_000, durationTicks: 2_000_000 },
        sourceDurationTicks: 20_000_000,
      },
    });

    expect(descriptor?.requestedSourceDurationTicks).toBe(20_000_000);
  });
});
