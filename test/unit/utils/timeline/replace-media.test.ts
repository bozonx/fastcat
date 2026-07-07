/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { buildReplaceMediaPatch } from '~/utils/timeline/replace-media';
import type { TimelineClipItem } from '~/timeline/types';

function makeClip(overrides: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'clip-1',
    trackId: 'track-1',
    name: 'clip',
    timelineRange: { startUs: 1_000_000, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    ...overrides,
  } as TimelineClipItem;
}

describe('utils/timeline/replace-media · buildReplaceMediaPatch', () => {
  it('only swaps source when new media is longer than the clip', () => {
    const clip = makeClip();
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/new.mp4',
      newSourceDurationUs: 20_000_000,
    });

    expect(patch.source).toEqual({ path: '/new.mp4' });
    expect(patch.sourceDurationUs).toBe(20_000_000);
    expect(patch.sourceRange).toBeUndefined();
    expect(patch.timelineRange).toBeUndefined();
  });

  it('only swaps source when new media equals the clip duration', () => {
    const clip = makeClip();
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/new.mp4',
      newSourceDurationUs: 5_000_000,
    });

    expect(patch.sourceRange).toBeUndefined();
    expect(patch.timelineRange).toBeUndefined();
  });

  it('clamps ranges when new media is shorter than the clip', () => {
    const clip = makeClip();
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/short.mp4',
      newSourceDurationUs: 2_000_000,
    });

    expect(patch.sourceRange).toEqual({ startUs: 0, durationUs: 2_000_000 });
    expect(patch.timelineRange).toEqual({ startUs: 1_000_000, durationUs: 2_000_000 });
    expect(patch.sourceDurationUs).toBe(2_000_000);
  });

  it('preserves timeline startUs (no ripple, gap left behind)', () => {
    const clip = makeClip({ timelineRange: { startUs: 9_000_000, durationUs: 5_000_000 } });
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/short.mp4',
      newSourceDurationUs: 1_000_000,
    });

    expect(patch.timelineRange).toEqual({ startUs: 9_000_000, durationUs: 1_000_000 });
  });

  it('keeps an in-range slip offset, clamping duration to what remains', () => {
    const clip = makeClip({
      sourceRange: { startUs: 1_000_000, durationUs: 5_000_000 },
      timelineRange: { startUs: 0, durationUs: 5_000_000 },
    });
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/short.mp4',
      newSourceDurationUs: 3_000_000,
    });

    // start 1s still fits inside 3s source; available = 2s
    expect(patch.sourceRange).toEqual({ startUs: 1_000_000, durationUs: 2_000_000 });
    expect(patch.timelineRange).toEqual({ startUs: 0, durationUs: 2_000_000 });
  });

  it('resets startUs to 0 when the slip offset is past the new source end', () => {
    const clip = makeClip({
      sourceRange: { startUs: 10_000_000, durationUs: 5_000_000 },
      timelineRange: { startUs: 0, durationUs: 5_000_000 },
    });
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/short.mp4',
      newSourceDurationUs: 4_000_000,
    });

    expect(patch.sourceRange).toEqual({ startUs: 0, durationUs: 4_000_000 });
    expect(patch.timelineRange).toEqual({ startUs: 0, durationUs: 4_000_000 });
  });

  it('scales the timeline duration by the clip speed', () => {
    const clip = makeClip({
      sourceRange: { startUs: 0, durationUs: 8_000_000 },
      timelineRange: { startUs: 0, durationUs: 4_000_000 },
      speed: 2,
    });
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/short.mp4',
      newSourceDurationUs: 2_000_000,
    });

    // available source = 2s, timeline = 2s / 2 = 1s
    expect(patch.sourceRange).toEqual({ startUs: 0, durationUs: 2_000_000 });
    expect(patch.timelineRange).toEqual({ startUs: 0, durationUs: 1_000_000 });
  });

  it('returns only the source swap when duration is unknown', () => {
    const clip = makeClip();
    const patch = buildReplaceMediaPatch({ clip, newPath: '/new.mp4', newSourceDurationUs: 0 });

    expect(patch).toEqual({ source: { path: '/new.mp4' } });
  });
});
