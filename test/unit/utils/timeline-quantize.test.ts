/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  quantizeTimeUsToFrames,
  assertNoOverlap,
  OVERLAP_EPSILON_US,
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
    expect(quantizeTimeUsToFrames(33_333, fps, 'round')).toBe(33_333);
    expect(quantizeTimeUsToFrames(50_000, fps, 'round')).toBe(66_667);
    expect(quantizeTimeUsToFrames(66_667, fps, 'round')).toBe(66_667);
  });

  it('floors to frame boundary', () => {
    const fps = 30;
    expect(quantizeTimeUsToFrames(66_666, fps, 'floor')).toBe(33_333);
    expect(quantizeTimeUsToFrames(66_667, fps, 'floor')).toBe(66_667);
  });

  it('ceils to frame boundary', () => {
    const fps = 30;
    expect(quantizeTimeUsToFrames(33_334, fps, 'ceil')).toBe(66_667);
    expect(quantizeTimeUsToFrames(33_333, fps, 'ceil')).toBe(33_333);
  });

  it('returns 0 for negative time', () => {
    expect(quantizeTimeUsToFrames(-1000, 30, 'round')).toBe(0);
  });
});

describe('assertNoOverlap', () => {
  it('does not throw for non-overlapping clips', () => {
    const track = makeTrack([makeClip('c1', 0, 1_000_000), makeClip('c2', 1_000_000, 1_000_000)]);
    expect(() => assertNoOverlap(track, '', 2_000_000, 1_000_000)).not.toThrow();
  });

  it('throws when new clip overlaps existing', () => {
    const track = makeTrack([makeClip('c1', 0, 1_000_000)]);
    expect(() => assertNoOverlap(track, '', 500_000, 1_000_000)).toThrow(
      'Item overlaps with another item',
    );
  });

  it('allows tiny epsilon overlap without throwing', () => {
    const track = makeTrack([makeClip('c1', 0, 1_000_000)]);
    // overlap of exactly OVERLAP_EPSILON_US should not throw
    expect(() =>
      assertNoOverlap(track, '', 1_000_000 - OVERLAP_EPSILON_US, 1_000_000),
    ).not.toThrow();
  });

  it('throws when overlap exceeds epsilon', () => {
    const track = makeTrack([makeClip('c1', 0, 1_000_000)]);
    expect(() => assertNoOverlap(track, '', 999_998, 1_000_000)).toThrow(
      'Item overlaps with another item',
    );
  });
});
