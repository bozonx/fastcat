/** @vitest-environment node */
import { timelineTicks } from './timeline-time';
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
    expect(quantizeTicksToFrames(timelineTicks(33_333), fps, 'round')).toBe(frameToTicks(1, fps));
    expect(quantizeTicksToFrames(timelineTicks(50_000), fps, 'round')).toBe(frameToTicks(2, fps));
    expect(quantizeTicksToFrames(timelineTicks(66_667), fps, 'round')).toBe(frameToTicks(2, fps));
  });

  it('floors to frame boundary', () => {
    const fps = 30;
    expect(quantizeTicksToFrames(timelineTicks(66_666), fps, 'floor')).toBe(frameToTicks(1, fps));
    expect(quantizeTicksToFrames(timelineTicks(66_667), fps, 'floor')).toBe(frameToTicks(2, fps));
  });

  it('ceils to frame boundary', () => {
    const fps = 30;
    expect(quantizeTicksToFrames(timelineTicks(33_334), fps, 'ceil')).toBe(frameToTicks(2, fps));
    expect(quantizeTicksToFrames(timelineTicks(33_333), fps, 'ceil')).toBe(frameToTicks(1, fps));
  });

  it('returns 0 for negative time', () => {
    expect(quantizeTicksToFrames(-1000, 30, 'round')).toBe(0);
  });
});

describe('assertNoOverlap', () => {
  it('does not throw for non-overlapping clips', () => {
    const track = makeTrack([
      makeClip('c1', 0, timelineTicks(1_000_000)),
      makeClip('c2', timelineTicks(1_000_000), timelineTicks(1_000_000)),
    ]);
    expect(() =>
      assertNoOverlap(track, '', timelineTicks(2_000_000), timelineTicks(1_000_000)),
    ).not.toThrow();
  });

  it('throws when new clip overlaps existing', () => {
    const track = makeTrack([makeClip('c1', 0, timelineTicks(1_000_000))]);
    expect(() =>
      assertNoOverlap(track, '', timelineTicks(500_000), timelineTicks(1_000_000)),
    ).toThrow('Item overlaps with another item');
  });

  it('allows tiny epsilon overlap without throwing', () => {
    const track = makeTrack([makeClip('c1', 0, timelineTicks(1_000_000))]);
    // overlap of exactly OVERLAP_EPSILON_TICKS should not throw
    expect(() =>
      assertNoOverlap(
        track,
        '',
        timelineTicks(1_000_000) - OVERLAP_EPSILON_TICKS,
        timelineTicks(1_000_000),
      ),
    ).not.toThrow();
  });

  it('throws when overlap exceeds epsilon', () => {
    const track = makeTrack([makeClip('c1', 0, timelineTicks(1_000_000))]);
    expect(() =>
      assertNoOverlap(track, '', timelineTicks(999_998), timelineTicks(1_000_000)),
    ).toThrow('Item overlaps with another item');
  });
});
