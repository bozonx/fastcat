/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import { TimelineClipLoader } from '~/utils/video-editor/compositor/TimelineClipLoader';

describe('TimelineClipLoader', () => {
  it('does not treat sourceRange duration as full source duration', () => {
    const loader = new TimelineClipLoader();
    const descriptor = loader.describe({
      index: 0,
      sequentialTimeUs: 0,
      clipData: {
        kind: 'clip',
        id: 'clip-1',
        clipType: 'media',
        source: { path: 'video.mp4' },
        timelineRange: { startUs: 0, durationUs: 2_000_000 },
        sourceRange: { startUs: 5_000_000, durationUs: 2_000_000 },
      },
    });

    expect(descriptor?.requestedSourceDurationUs).toBe(0);
    expect(descriptor?.requestedSourceRangeDurationUs).toBe(2_000_000);
  });

  it('preserves explicit sourceDurationUs when available', () => {
    const loader = new TimelineClipLoader();
    const descriptor = loader.describe({
      index: 0,
      sequentialTimeUs: 0,
      clipData: {
        kind: 'clip',
        id: 'clip-1',
        clipType: 'media',
        source: { path: 'video.mp4' },
        timelineRange: { startUs: 0, durationUs: 2_000_000 },
        sourceRange: { startUs: 5_000_000, durationUs: 2_000_000 },
        sourceDurationUs: 20_000_000,
      },
    });

    expect(descriptor?.requestedSourceDurationUs).toBe(20_000_000);
  });
});
