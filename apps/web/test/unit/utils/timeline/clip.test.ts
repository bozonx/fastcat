/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  clampHandlePx,
  getClipHeadTimelineHandleTicks,
  getClipTailTimelineHandleTicks,
  getClipMaxTimelineDurationTicks,
} from '~/utils/timeline/clip';
import type { TimelineClipItem } from '~/timeline/types';

describe('utils/timeline/clip', () => {
  it('clampHandlePx clamps to clip padding', () => {
    expect(clampHandlePx(0, 100)).toBe(3);
    expect(clampHandlePx(200, 100)).toBe(97);
    expect(clampHandlePx(50, 100)).toBe(50);
  });

  const baseClip: Partial<TimelineClipItem> = {
    kind: 'clip',
    clipType: 'media',
    sourceRange: { startTicks: 2000, durationTicks: 3000 },
    sourceDurationTicks: 10000,
  };

  describe('handle timeline durations', () => {
    it('normal speed (1.0)', () => {
      const clip = { ...baseClip, speed: 1.0 } as TimelineClipItem;
      // head: source (2000) / 1.0 = 2000
      // tail: (10000 - (2000 + 3000)) = 5000 / 1.0 = 5000
      expect(getClipHeadTimelineHandleTicks(clip)).toBe(2000);
      expect(getClipTailTimelineHandleTicks(clip)).toBe(5000);
    });

    it('double speed (2.0)', () => {
      const clip = { ...baseClip, speed: 2.0 } as TimelineClipItem;
      // head: source (2000) / 2.0 = 1000
      // tail: source (5000) / 2.0 = 2500
      expect(getClipHeadTimelineHandleTicks(clip)).toBe(1000);
      expect(getClipTailTimelineHandleTicks(clip)).toBe(2500);
    });

    it('half speed (0.5)', () => {
      const clip = { ...baseClip, speed: 0.5 } as TimelineClipItem;
      // head: 2000 / 0.5 = 4000
      // tail: 5000 / 0.5 = 10000
      expect(getClipHeadTimelineHandleTicks(clip)).toBe(4000);
      expect(getClipTailTimelineHandleTicks(clip)).toBe(10000);
    });

    it('reverse speed (-1.0)', () => {
      const clip = { ...baseClip, speed: -1.0 } as TimelineClipItem;
      // head on timeline corresponds to physical tail in source
      // head: sourceTail (5000) / 1.0 = 5000
      // tail: sourceHead (2000) / 1.0 = 2000
      expect(getClipHeadTimelineHandleTicks(clip)).toBe(5000);
      expect(getClipTailTimelineHandleTicks(clip)).toBe(2000);
    });

    it('reverse speed (-2.0)', () => {
      const clip = { ...baseClip, speed: -2.0 } as TimelineClipItem;
      // head: sourceTail (5000) / 2.0 = 2500
      // tail: sourceHead (2000) / 2.0 = 1000
      expect(getClipHeadTimelineHandleTicks(clip)).toBe(2500);
      expect(getClipTailTimelineHandleTicks(clip)).toBe(1000);
    });

    it('handles image clip (infinite handles)', () => {
      const clip = { ...baseClip, speed: 1.0, isImage: true } as TimelineClipItem;
      expect(getClipHeadTimelineHandleTicks(clip)).toBe(Number.POSITIVE_INFINITY);
      expect(getClipTailTimelineHandleTicks(clip)).toBe(Number.POSITIVE_INFINITY);
    });

    it('handles speed 0 (safe fallback)', () => {
      const clip = { ...baseClip, speed: 0 } as TimelineClipItem;
      expect(getClipHeadTimelineHandleTicks(clip)).toBe(Number.POSITIVE_INFINITY);
      expect(getClipTailTimelineHandleTicks(clip)).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe('getClipMaxTimelineDurationTicks', () => {
    it('returns sourceDurationTicks / absSpeed for media clips', () => {
      const clip = { ...baseClip, speed: 1.0, sourceDurationTicks: 10_000 } as TimelineClipItem;
      expect(getClipMaxTimelineDurationTicks(clip)).toBe(10_000);
    });

    it('scales by speed (2.0 -> half duration)', () => {
      const clip = { ...baseClip, speed: 2.0, sourceDurationTicks: 10_000 } as TimelineClipItem;
      expect(getClipMaxTimelineDurationTicks(clip)).toBe(5_000);
    });

    it('scales by abs speed for reverse (-2.0)', () => {
      const clip = { ...baseClip, speed: -2.0, sourceDurationTicks: 10_000 } as TimelineClipItem;
      expect(getClipMaxTimelineDurationTicks(clip)).toBe(5_000);
    });

    it('returns Infinity for image clips even with sourceDurationTicks', () => {
      const clip = {
        ...baseClip,
        speed: 1.0,
        sourceDurationTicks: 10_000,
        isImage: true,
      } as TimelineClipItem;
      expect(getClipMaxTimelineDurationTicks(clip)).toBe(Number.POSITIVE_INFINITY);
    });

    it('returns Infinity for virtual clips (text/shape/background)', () => {
      const textClip = { ...baseClip, clipType: 'text', speed: 1.0 } as TimelineClipItem;
      expect(getClipMaxTimelineDurationTicks(textClip)).toBe(Number.POSITIVE_INFINITY);
    });

    it('returns Infinity for timeline clip type', () => {
      const timelineClip = {
        ...baseClip,
        clipType: 'timeline',
        speed: 1.0,
        sourceDurationTicks: 8_000,
      } as TimelineClipItem;
      expect(getClipMaxTimelineDurationTicks(timelineClip)).toBe(8_000);
    });

    it('returns Infinity when sourceDurationTicks is missing/invalid', () => {
      const noDuration = {
        ...baseClip,
        speed: 1.0,
        sourceDurationTicks: undefined,
      } as TimelineClipItem;
      expect(getClipMaxTimelineDurationTicks(noDuration)).toBe(Number.POSITIVE_INFINITY);

      const zeroDuration = { ...baseClip, speed: 1.0, sourceDurationTicks: 0 } as TimelineClipItem;
      expect(getClipMaxTimelineDurationTicks(zeroDuration)).toBe(Number.POSITIVE_INFINITY);
    });
  });
});
