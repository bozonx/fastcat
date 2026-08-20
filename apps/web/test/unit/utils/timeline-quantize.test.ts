/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  quantizeTicksToFrames,
  assertNoOverlap,
  OVERLAP_EPSILON_TICKS,
  frameToTicks,
} from '~/timeline/commands/utils';
import type { TimelineTrack, TimelineClipItem } from '~/timeline/types';

function makeTrack(items: TimelineClipItem[]): TimelineTrack {
  return {
    id: 't1',
    kind: 'video',
    name: 'V1',
    items: items as any,
  };
}

function makeClip(id: string, startTicks: number, durationTicks: number): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id,
    trackId: 't1',
    name: id,
    timelineRange: { startTicks, durationTicks },
    sourceRange: { startTicks: 0, durationTicks },
    source: { path: 'video/a.mp4' },
    sourceDurationTicks: durationTicks,
  };
}

describe('quantizeTicksToFrames', () => {
  it('rounds to nearest frame at 30fps', () => {
    const fps = 30;
    // 1 frame = 33333.333... us
    expect(quantizeTicksToFrames(8_467_115_328, fps, 'round')).toBe(frameToTicks(1, fps));
    expect(quantizeTicksToFrames(12_700_800_000, fps, 'round')).toBe(frameToTicks(2, fps));
    expect(quantizeTicksToFrames(16_934_484_672, fps, 'round')).toBe(frameToTicks(2, fps));
  });

  it('floors to frame boundary', () => {
    const fps = 30;
    expect(quantizeTicksToFrames(16_934_230_656, fps, 'floor')).toBe(frameToTicks(1, fps));
    expect(quantizeTicksToFrames(16_934_484_672, fps, 'floor')).toBe(frameToTicks(2, fps));
  });

  it('ceils to frame boundary', () => {
    const fps = 30;
    expect(quantizeTicksToFrames(8_467_369_344, fps, 'ceil')).toBe(frameToTicks(2, fps));
    expect(quantizeTicksToFrames(8_467_115_328, fps, 'ceil')).toBe(frameToTicks(1, fps));
  });

  it('returns 0 for negative time', () => {
    expect(quantizeTicksToFrames(-1000, 30, 'round')).toBe(0);
  });
});

describe('assertNoOverlap', () => {
  it('does not throw for non-overlapping clips', () => {
    const track = makeTrack([
      makeClip('c1', 0, 254_016_000_000),
      makeClip('c2', 254_016_000_000, 254_016_000_000),
    ]);
    expect(() => assertNoOverlap(track, '', 508_032_000_000, 254_016_000_000)).not.toThrow();
  });

  it('throws when new clip overlaps existing', () => {
    const track = makeTrack([makeClip('c1', 0, 254_016_000_000)]);
    expect(() => assertNoOverlap(track, '', 127_008_000_000, 254_016_000_000)).toThrow(
      'Item overlaps with another item',
    );
  });

  it('allows tiny epsilon overlap without throwing', () => {
    const track = makeTrack([makeClip('c1', 0, 254_016_000_000)]);
    // overlap of exactly OVERLAP_EPSILON_TICKS should not throw
    expect(() =>
      assertNoOverlap(track, '', 254_016_000_000 - OVERLAP_EPSILON_TICKS, 254_016_000_000),
    ).not.toThrow();
  });

  it('throws when overlap exceeds epsilon', () => {
    const track = makeTrack([makeClip('c1', 0, 254_016_000_000)]);
    expect(() => assertNoOverlap(track, '', 254_015_491_968, 254_016_000_000)).toThrow(
      'Item overlaps with another item',
    );
  });
});
