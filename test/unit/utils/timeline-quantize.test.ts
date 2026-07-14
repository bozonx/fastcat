/** @vitest-environment node */
import { timelineUs } from './timeline-time';
import { describe, it, expect } from 'vitest';
import {
  quantizeTimeUsToFrames,
  assertNoOverlap,
  OVERLAP_EPSILON_US,
  frameToUs,
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

function makeClip(id: string, startUs: number, durationUs: number): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id,
    trackId: 't1',
    name: id,
    timelineRange: { startUs, durationUs },
    sourceRange: { startUs: 0, durationUs },
    source: { path: 'video/a.mp4' },
    sourceDurationUs: durationUs,
  };
}

describe('quantizeTimeUsToFrames', () => {
  it('rounds to nearest frame at 30fps', () => {
    const fps = 30;
    // 1 frame = 33333.333... us
    expect(quantizeTimeUsToFrames(timelineUs(33_333), fps, 'round')).toBe(frameToUs(1, fps));
    expect(quantizeTimeUsToFrames(timelineUs(50_000), fps, 'round')).toBe(frameToUs(2, fps));
    expect(quantizeTimeUsToFrames(timelineUs(66_667), fps, 'round')).toBe(frameToUs(2, fps));
  });

  it('floors to frame boundary', () => {
    const fps = 30;
    expect(quantizeTimeUsToFrames(timelineUs(66_666), fps, 'floor')).toBe(frameToUs(1, fps));
    expect(quantizeTimeUsToFrames(timelineUs(66_667), fps, 'floor')).toBe(frameToUs(2, fps));
  });

  it('ceils to frame boundary', () => {
    const fps = 30;
    expect(quantizeTimeUsToFrames(timelineUs(33_334), fps, 'ceil')).toBe(frameToUs(2, fps));
    expect(quantizeTimeUsToFrames(timelineUs(33_333), fps, 'ceil')).toBe(frameToUs(1, fps));
  });

  it('returns 0 for negative time', () => {
    expect(quantizeTimeUsToFrames(-1000, 30, 'round')).toBe(0);
  });
});

describe('assertNoOverlap', () => {
  it('does not throw for non-overlapping clips', () => {
    const track = makeTrack([
      makeClip('c1', 0, timelineUs(1_000_000)),
      makeClip('c2', timelineUs(1_000_000), timelineUs(1_000_000)),
    ]);
    expect(() =>
      assertNoOverlap(track, '', timelineUs(2_000_000), timelineUs(1_000_000)),
    ).not.toThrow();
  });

  it('throws when new clip overlaps existing', () => {
    const track = makeTrack([makeClip('c1', 0, timelineUs(1_000_000))]);
    expect(() => assertNoOverlap(track, '', timelineUs(500_000), timelineUs(1_000_000))).toThrow(
      'Item overlaps with another item',
    );
  });

  it('allows tiny epsilon overlap without throwing', () => {
    const track = makeTrack([makeClip('c1', 0, timelineUs(1_000_000))]);
    // overlap of exactly OVERLAP_EPSILON_US should not throw
    expect(() =>
      assertNoOverlap(track, '', timelineUs(1_000_000) - OVERLAP_EPSILON_US, timelineUs(1_000_000)),
    ).not.toThrow();
  });

  it('throws when overlap exceeds epsilon', () => {
    const track = makeTrack([makeClip('c1', 0, timelineUs(1_000_000))]);
    expect(() => assertNoOverlap(track, '', timelineUs(999_998), timelineUs(1_000_000))).toThrow(
      'Item overlaps with another item',
    );
  });
});
