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
    timelineRange: { startTicks: 1_000_000, durationTicks: 5_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
    ...overrides,
  } as TimelineClipItem;
}

describe('utils/timeline/replace-media · buildReplaceMediaPatch', () => {
  it('only swaps source when new media is longer than the clip', () => {
    const clip = makeClip();
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/new.mp4',
      newSourceDurationTicks: 20_000_000,
    });

    expect(patch.source).toEqual({ path: '/new.mp4' });
    expect(patch.sourceDurationTicks).toBe(20_000_000);
    expect(patch.sourceRange).toBeUndefined();
    expect(patch.timelineRange).toBeUndefined();
  });

  it('only swaps source when new media equals the clip duration', () => {
    const clip = makeClip();
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/new.mp4',
      newSourceDurationTicks: 5_000_000,
    });

    expect(patch.sourceRange).toBeUndefined();
    expect(patch.timelineRange).toBeUndefined();
  });

  it('clamps ranges when new media is shorter than the clip', () => {
    const clip = makeClip();
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/short.mp4',
      newSourceDurationTicks: 2_000_000,
    });

    expect(patch.sourceRange).toEqual({ startTicks: 0, durationTicks: 2_000_000 });
    expect(patch.timelineRange).toEqual({ startTicks: 1_000_000, durationTicks: 2_000_000 });
    expect(patch.sourceDurationTicks).toBe(2_000_000);
  });

  it('preserves timeline startTicks (no ripple, gap left behind)', () => {
    const clip = makeClip({ timelineRange: { startTicks: 9_000_000, durationTicks: 5_000_000 } });
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/short.mp4',
      newSourceDurationTicks: 1_000_000,
    });

    expect(patch.timelineRange).toEqual({ startTicks: 9_000_000, durationTicks: 1_000_000 });
  });

  it('keeps an in-range slip offset, clamping duration to what remains', () => {
    const clip = makeClip({
      sourceRange: { startTicks: 1_000_000, durationTicks: 5_000_000 },
      timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
    });
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/short.mp4',
      newSourceDurationTicks: 3_000_000,
    });

    // start 1s still fits inside 3s source; available = 2s
    expect(patch.sourceRange).toEqual({ startTicks: 1_000_000, durationTicks: 2_000_000 });
    expect(patch.timelineRange).toEqual({ startTicks: 0, durationTicks: 2_000_000 });
  });

  it('resets startTicks to 0 when the slip offset is past the new source end', () => {
    const clip = makeClip({
      sourceRange: { startTicks: 10_000_000, durationTicks: 5_000_000 },
      timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
    });
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/short.mp4',
      newSourceDurationTicks: 4_000_000,
    });

    expect(patch.sourceRange).toEqual({ startTicks: 0, durationTicks: 4_000_000 });
    expect(patch.timelineRange).toEqual({ startTicks: 0, durationTicks: 4_000_000 });
  });

  it('scales the timeline duration by the clip speed', () => {
    const clip = makeClip({
      sourceRange: { startTicks: 0, durationTicks: 8_000_000 },
      timelineRange: { startTicks: 0, durationTicks: 4_000_000 },
      speed: 2,
    });
    const patch = buildReplaceMediaPatch({
      clip,
      newPath: '/short.mp4',
      newSourceDurationTicks: 2_000_000,
    });

    // available source = 2s, timeline = 2s / 2 = 1s
    expect(patch.sourceRange).toEqual({ startTicks: 0, durationTicks: 2_000_000 });
    expect(patch.timelineRange).toEqual({ startTicks: 0, durationTicks: 1_000_000 });
  });

  it('returns only the source swap when duration is unknown', () => {
    const clip = makeClip();
    const patch = buildReplaceMediaPatch({ clip, newPath: '/new.mp4', newSourceDurationTicks: 0 });

    expect(patch).toEqual({ source: { path: '/new.mp4' } });
  });
});
